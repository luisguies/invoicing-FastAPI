#!/usr/bin/env python3
"""
Extract structured data from an old invoice PDF.
Format: Bill To (carrier), Invoice #, Date, Due Date, driver sections with load lines.
Load lines: Pickup Date, Delivery Date, Origin, Destination, Price, Rate, Amount.
Sections are headed by "Driver: {name}".
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pdfplumber


def extract_text_from_pdf(pdf_path: str) -> Optional[str]:
    """Extract text from PDF using pdfplumber."""
    try:
        parts = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    parts.append(t)
        return "\n".join(parts) if parts else None
    except Exception as e:
        print(f"Error extracting text: {e}")
        return None


def parse_date_mdy(s: str) -> Optional[str]:
    """Parse MM/DD/YYYY to YYYY-MM-DD."""
    if not s or not s.strip():
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_money(s: str) -> Optional[float]:
    """Parse $1,234.56 or 1234.56 to float."""
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_header(text: str) -> Dict[str, Any]:
    """Extract Bill To, Invoice #, Date, Due Date, Balance Due from header."""
    out = {
        "carrierName": "",
        "invoiceNumber": "",
        "invoiceDate": "",
        "dueDate": "",
        "balanceDue": None,
        "payableToName": "",
        "payableToCityStateZip": "",
        "payableToPhone": "",
        "billToCityStateZip": "",
        "billToPhone": "",
    }
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    in_bill_to = False
    in_payable_to = False
    payable_lines = []
    bill_to_lines = []

    for i, line in enumerate(lines):
        if "Bill To:" in line or line == "Bill To:":
            in_bill_to = True
            in_payable_to = False
            rest = line.replace("Bill To:", "").strip()
            if rest:
                out["carrierName"] = rest
            continue
        if "Payable To:" in line or line == "Payable To:":
            in_payable_to = True
            in_bill_to = False
            rest = line.replace("Payable To:", "").strip()
            if rest:
                payable_lines.append(rest)
            continue
        if in_payable_to and (line.startswith("Subtotal:") or line.startswith("Total:") or line.startswith("Postage:")):
            in_payable_to = False
        if in_bill_to:
            if not out["carrierName"]:
                out["carrierName"] = line
            elif re.match(r"^\d", line) or "," in line:
                bill_to_lines.append(line)
            else:
                in_bill_to = False
        if in_payable_to and not any(
            line.startswith(x) for x in ("Subtotal:", "Total:", "Postage:", "We thank")
        ):
            payable_lines.append(line)

        if "Invoice #:" in line or "Invoice #" in line:
            m = re.search(r"Invoice\s*#:?\s*(\S+)", line, re.I)
            if m:
                out["invoiceNumber"] = m.group(1).strip()
        if re.match(r"^Date:\s*\d", line, re.I):
            m = re.search(r"Date:\s*(\S+)", line, re.I)
            if m:
                out["invoiceDate"] = parse_date_mdy(m.group(1)) or m.group(1).strip()
        if "Due Date:" in line:
            m = re.search(r"Due Date:\s*(\S+)", line, re.I)
            if m:
                out["dueDate"] = parse_date_mdy(m.group(1)) or m.group(1).strip()
        if "Balance Due" in line:
            m = re.search(r"Balance Due\s*\$?([\d,]+\.?\d*)", line, re.I)
            if m:
                out["balanceDue"] = parse_money(m.group(1))
        if "Subtotal:" in line:
            m = re.search(r"Subtotal:\s*\$?([\d,]+\.?\d*)", line, re.I)
            if m:
                out["subtotal"] = parse_money(m.group(1))
        if "Postage:" in line:
            m = re.search(r"Postage:\s*\$?([\d,]+\.?\d*)", line, re.I)
            if m:
                out["postage"] = parse_money(m.group(1))
        if re.search(r"^Total:\s*\$", line, re.I):
            m = re.search(r"Total:\s*\$?([\d,]+\.?\d*)", line, re.I)
            if m:
                out["total"] = parse_money(m.group(1))

    if payable_lines:
        out["payableToName"] = payable_lines[0]
        out["payableToCityStateZip"] = " ".join(payable_lines[1:]) if len(payable_lines) > 1 else ""
    if bill_to_lines:
        out["billToCityStateZip"] = " ".join(bill_to_lines)
    return out


def parse_load_line(line: str) -> Optional[Dict[str, str]]:
    """
    Parse a line like:
    09/19/2025 09/23/2025 Houston, TX WESTON, WV $3,200.00 5% $160.00
    Columns: Pickup, Delivery, Origin, Destination, Price, Rate, Amount.
    """
    line = line.strip()
    date_part = r"(\d{1,2}/\d{1,2}/\d{4})"
    m = re.match(rf"{date_part}\s+{date_part}\s+(.+)", line)
    if not m:
        return None
    pickup_str, delivery_str, rest = m.group(1), m.group(2), m.group(3)
    # From the end: price ($3,200.00), rate (5%), amount ($160.00)
    tail = re.search(r"\$?([\d,]+\.?\d*)\s+(\d+%?)\s+\$?([\d,]+\.?\d*)\s*$", rest)
    if not tail:
        return None
    price_str = tail.group(1).replace(",", "")
    rate_str = tail.group(2)
    amount_str = tail.group(3).replace(",", "")
    middle = rest[: tail.start()].strip()
    # Split middle into origin and destination: "City, ST City, ST"
    parts = re.split(r",\s*([A-Z]{2})\s+", middle, maxsplit=1)
    if len(parts) >= 3:
        origin = (parts[0] + ", " + parts[1]).strip()
        dest = parts[2].strip()
    else:
        idx = middle.rfind(", ")
        if idx > 0 and len(middle) - idx <= 5:
            origin = middle[:idx].strip()
            dest = middle[idx + 2 :].strip()
        else:
            origin = middle
            dest = ""
    return {
        "pickupDate": pickup_str,
        "deliveryDate": delivery_str,
        "originCityState": origin,
        "destCityState": dest,
        "price": price_str,
        "ratePercent": rate_str,
        "amount": amount_str,
    }


def parse_driver_sections(text: str) -> List[Dict[str, Any]]:
    """
    Split text by "Driver: {name}" and parse each section's load lines.
    """
    groups = []
    # Normalize: one line per Driver
    lines = text.splitlines()
    current_driver = None
    current_rate = ""
    current_lines = []

    for line in lines:
        line_stripped = line.strip()
        driver_m = re.match(r"Driver:\s*(.+)", line_stripped, re.I)
        if driver_m:
            if current_driver is not None and current_lines:
                groups.append({
                    "groupLabel": current_driver.strip(),
                    "groupRate": current_rate or "5%",
                    "lines": current_lines,
                })
            current_driver = driver_m.group(1).strip()
            current_rate = ""
            current_lines = []
            continue
        # Try to parse as load line (starts with date)
        if re.match(r"\d{1,2}/\d{1,2}/\d{4}", line_stripped):
            parsed = parse_load_line(line_stripped)
            if parsed:
                current_lines.append(parsed)
                if parsed.get("ratePercent") and not current_rate:
                    current_rate = parsed["ratePercent"]

    if current_driver is not None and current_lines:
        groups.append({
            "groupLabel": current_driver.strip(),
            "groupRate": current_rate or "5%",
            "lines": current_lines,
        })
    return groups


def _is_valid_gemini_result(data: Optional[Dict[str, Any]]) -> bool:
    """Return True if Gemini output has enough to use (carrier + groups or total)."""
    if not data or not isinstance(data, dict):
        return False
    if not (data.get("carrierName") or (data.get("billTo") or {}).get("name")):
        return False
    groups = data.get("groups")
    if isinstance(groups, list) and len(groups) > 0:
        return True
    if data.get("total") is not None or data.get("balanceDue") is not None:
        return True
    return False


def extract_old_invoice(pdf_path: str) -> Optional[Dict[str, Any]]:
    """
    Extract full invoice structure from an old invoice PDF.
    Uses Google Gemini API first (if GEMINI_API_KEY is set), then falls back to regex parsing.
    Returns dict with: carrierName, invoiceNumber, invoiceDate, dueDate,
    balanceDue, subtotal, postage, total, billTo, payableTo, groups (driver sections with lines).
    """
    text = extract_text_from_pdf(pdf_path)
    if not text or len(text.strip()) < 50:
        return None

    # Try Gemini first (same pattern as load OCR)
    if os.getenv("GEMINI_API_KEY"):
        try:
            import gemini_extract_old_invoice as geo
            gemini_result = geo.extract_old_invoice_with_gemini(text)
            if _is_valid_gemini_result(gemini_result):
                return gemini_result
        except Exception as e:
            print(f"Gemini extraction skipped: {e}")

    header = parse_header(text)
    groups = parse_driver_sections(text)

    # Ensure totals
    if header.get("balanceDue") is None and header.get("total") is not None:
        header["balanceDue"] = header["total"]
    if header.get("subtotal") is None and header.get("total") is not None:
        header["subtotal"] = header["total"]
    if header.get("postage") is None:
        header["postage"] = 0.0

    result = {
        "carrierName": header.get("carrierName") or "",
        "invoiceNumber": header.get("invoiceNumber") or "",
        "invoiceDate": header.get("invoiceDate") or "",
        "dueDate": header.get("dueDate") or "",
        "balanceDue": header.get("balanceDue"),
        "subtotal": header.get("subtotal"),
        "postage": header.get("postage"),
        "total": header.get("total"),
        "billTo": {
            "name": header.get("carrierName") or "",
            "cityStateZip": header.get("billToCityStateZip") or "",
            "phone": header.get("billToPhone") or "",
        },
        "payableTo": {
            "name": header.get("payableToName") or "",
            "cityStateZip": header.get("payableToCityStateZip") or "",
            "phone": header.get("payableToPhone") or "",
        },
        "groups": groups,
    }
    return result


def main():
    import sys
    if len(sys.argv) < 2:
        print("Usage: python extract_old_invoice.py <pdf_path>")
        sys.exit(1)
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"File not found: {path}")
        sys.exit(1)
    data = extract_old_invoice(path)
    if data:
        print(json.dumps(data, indent=2))
    else:
        print("{}")
        sys.exit(1)


if __name__ == "__main__":
    main()
