#!/usr/bin/env python3
"""
Deprecated wrapper.

Use `backfill_invoice_week.py` (corrected rule: invoice Monday is the Monday of the delivery week,
and only push to next week when pickup happens on that invoice Monday).
"""

from backfill_invoice_week import main


if __name__ == "__main__":
    raise SystemExit(main())


