#!/usr/bin/env python3
"""
Backfill and auto-assign invoice week fields for all loads in MongoDB.

Corrected business rules:
- invoice_monday is the Monday of the delivery week.
  - If delivery is on a Monday, invoice_monday is that same Monday.
- Loads must be delivered first before being invoiced (we require delivery_date to exist/parse).
- Exception: if a load is picked up ON invoice_monday (same calendar date), it belongs to the next invoice week.

Storage:
- invoice_monday stored as a UTC datetime at midnight.
- invoice_week_id stored as a YYYY-MM-DD string (same date as invoice_monday).

Safety/idempotency:
- Safe to run multiple times (deterministic calculation; only updates when values differ).
- Skips records missing pickup_date or delivery_date.
- Only $set's invoice_monday and invoice_week_id; does not touch other fields.

Constraints:
- Uses pymongo.
- Does not do date math in Mongo queries (all date math is done in Python).
- Handles date, datetime, and ISO-like string inputs.
- Logic is explicit/readable (no clever shortcuts).
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from pymongo import MongoClient, UpdateOne


UTC = timezone.utc


def _parse_isoish_string(value: str) -> Optional[datetime]:
    """
    Parse an ISO-like datetime string into a timezone-aware UTC datetime.
    Returns None if it cannot be parsed.
    """
    s = value.strip()
    if not s:
        return None

    # Allow trailing 'Z' to mean UTC.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    # Try full datetime parsing first.
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = None

    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            # If tz is missing, assume UTC (Mongo datetimes are UTC but often naive in Python).
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    # Try date-only format.
    try:
        d = date.fromisoformat(s)
    except ValueError:
        return None

    return datetime.combine(d, time(0, 0), tzinfo=UTC)


def parse_dateish(value: Any) -> Optional[datetime]:
    """
    Convert supported MongoDB field types into a timezone-aware UTC datetime.
    Supported:
    - datetime (naive assumed UTC, aware converted to UTC)
    - date (treated as midnight UTC)
    - ISO-like string (date or datetime, optional 'Z')
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    if isinstance(value, date):
        # Note: datetime is also a date; must come after datetime check.
        return datetime.combine(value, time(0, 0), tzinfo=UTC)

    if isinstance(value, str):
        return _parse_isoish_string(value)

    return None


def monday_of_week(day: date) -> date:
    """
    Return the Monday (start) of the week containing 'day'.
    Week definition: Monday=0 ... Sunday=6 (Python's date.weekday()).
    """
    weekday = day.weekday()
    return day - timedelta(days=weekday)


def compute_invoice_fields(pickup_dt_utc: datetime, delivery_dt_utc: datetime) -> Tuple[datetime, str]:
    """
    Apply corrected business rules to compute invoice_monday and invoice_week_id.
    """
    delivery_day = delivery_dt_utc.date()
    invoice_day = monday_of_week(delivery_day)
    invoice_monday = datetime.combine(invoice_day, time(0, 0), tzinfo=UTC)

    # Exception: if pickup happens on the invoice Monday (same calendar date), push to next week.
    if pickup_dt_utc.date() == invoice_monday.date():
        invoice_monday = invoice_monday + timedelta(days=7)

    invoice_week_id = invoice_monday.date().isoformat()  # YYYY-MM-DD
    return invoice_monday, invoice_week_id


def _coerce_existing_invoice_monday(value: Any) -> Optional[datetime]:
    """
    Parse an existing invoice_monday from the document so we can compare
    with computed values for idempotent updates.
    """
    return parse_dateish(value)


def _existing_week_id_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


@dataclass
class Counters:
    scanned: int = 0
    updated: int = 0
    skipped_missing_dates: int = 0
    skipped_unparseable_dates: int = 0
    skipped_no_change: int = 0
    errors: int = 0


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Backfill invoice_monday and invoice_week_id for all loads (delivery-week Monday rule)."
    )
    p.add_argument(
        "--mongo-uri",
        default=os.getenv("MONGODB_URI", "mongodb://mongodb:27017/invoicing"),
        help="MongoDB connection URI. Default: env MONGODB_URI or mongodb://mongodb:27017/invoicing",
    )
    p.add_argument(
        "--db",
        default=None,
        help="Database name. Default: taken from --mongo-uri, or 'invoicing' if not present.",
    )
    p.add_argument(
        "--collection",
        default="loads",
        help="Collection name containing loads. Default: loads",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and report changes without writing updates.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of loads processed (0 means no limit).",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Cursor batch size when reading loads. Default: 500",
    )
    p.add_argument(
        "--write-batch-size",
        type=int,
        default=500,
        help="Bulk write batch size. Default: 500",
    )
    return p


def resolve_db_name(mongo_uri: str, explicit_db: Optional[str]) -> str:
    if explicit_db:
        return explicit_db

    # pymongo parses the DB name from the URI path if present.
    # If not present, fall back to "invoicing" (matches docker-compose).
    try:
        client = MongoClient(mongo_uri)
        parsed = client.get_default_database()
        if parsed is not None:
            return parsed.name
    except Exception:
        # If parsing fails for any reason, fall back.
        pass

    return "invoicing"


def main() -> int:
    args = build_arg_parser().parse_args()

    db_name = resolve_db_name(args.mongo_uri, args.db)
    client = MongoClient(args.mongo_uri)
    db = client[db_name]
    loads = db[args.collection]

    query: Dict[str, Any] = {
        "pickup_date": {"$exists": True, "$ne": None},
        "delivery_date": {"$exists": True, "$ne": None},
    }
    projection = {
        "_id": 1,
        "pickup_date": 1,
        "delivery_date": 1,
        "invoice_monday": 1,
        "invoice_week_id": 1,
    }

    cursor = loads.find(query, projection=projection, batch_size=args.batch_size)
    if args.limit and args.limit > 0:
        cursor = cursor.limit(args.limit)

    counters = Counters()
    pending_updates = []

    def flush_updates() -> None:
        nonlocal pending_updates
        if not pending_updates:
            return
        if args.dry_run:
            pending_updates = []
            return
        result = loads.bulk_write(pending_updates, ordered=False)
        counters.updated += result.modified_count
        pending_updates = []

    try:
        for doc in cursor:
            counters.scanned += 1

            pickup_dt = parse_dateish(doc.get("pickup_date"))
            delivery_dt = parse_dateish(doc.get("delivery_date"))

            if pickup_dt is None or delivery_dt is None:
                # Dates exist per query but may be unparseable/unsupported types.
                if doc.get("pickup_date") is None or doc.get("delivery_date") is None:
                    counters.skipped_missing_dates += 1
                else:
                    counters.skipped_unparseable_dates += 1
                continue

            invoice_monday, invoice_week_id = compute_invoice_fields(pickup_dt, delivery_dt)

            existing_invoice_monday = _coerce_existing_invoice_monday(doc.get("invoice_monday"))
            existing_week_id = _existing_week_id_str(doc.get("invoice_week_id"))

            same_invoice_monday = (
                existing_invoice_monday is not None and existing_invoice_monday == invoice_monday
            )
            same_week_id = existing_week_id is not None and existing_week_id == invoice_week_id

            if same_invoice_monday and same_week_id:
                counters.skipped_no_change += 1
                continue

            update_doc = {
                "$set": {
                    "invoice_monday": invoice_monday,
                    "invoice_week_id": invoice_week_id,
                }
            }
            pending_updates.append(UpdateOne({"_id": doc["_id"]}, update_doc))

            # For dry-run, count "would update" precisely.
            if args.dry_run:
                counters.updated += 1

            if len(pending_updates) >= args.write_batch_size:
                flush_updates()

        flush_updates()

    except Exception:
        counters.errors += 1
        raise
    finally:
        client.close()

    print("Backfill complete.")
    print(f"mongo_uri: {args.mongo_uri}")
    print(f"db: {db_name}")
    print(f"collection: {args.collection}")
    print(f"dry_run: {args.dry_run}")
    print(f"scanned: {counters.scanned}")
    print(f"updated: {counters.updated}")
    print(f"skipped_missing_dates: {counters.skipped_missing_dates}")
    print(f"skipped_unparseable_dates: {counters.skipped_unparseable_dates}")
    print(f"skipped_no_change: {counters.skipped_no_change}")
    print(f"errors: {counters.errors}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


