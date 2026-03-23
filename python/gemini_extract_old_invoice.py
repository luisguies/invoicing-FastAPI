#!/usr/bin/env python3
"""
Extract structured data from an old invoice PDF using Google Gemini API.
Uses the same pattern as gemini_extract_key_fields.py (load OCR).
Takes raw text from the invoice and returns JSON: carrierName, dates, billTo, payableTo,
groups (driver sections with lines: pickupDate, deliveryDate, origin, destination, price, rate, amount).
"""

import json
import os
from typing import Any, Dict, Optional

import google.generativeai as genai

from ai_helpers import gemini_generate_content_with_retry


def setup_gemini():
    """Initialize Gemini API with credentials (same as load OCR)."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in environment variables.")
        print("Please set it with: $env:GEMINI_API_KEY='your-api-key'")
        print("Get your free API key at: https://makersuite.google.com/app/apikey")
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-2.5-flash")


def _clean_json_response(text: str) -> str:
    """Remove markdown code fences from model output."""
    if not text or not text.strip():
        return ""
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def extract_old_invoice_with_gemini(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Send invoice raw text to Gemini and get structured JSON.
    Returns the same shape as extract_old_invoice.py: carrierName, invoiceNumber,
    invoiceDate, dueDate, balanceDue, subtotal, postage, total, billTo, payableTo, groups.
    """
    model = setup_gemini()
    if not model:
        return None

    prompt = f"""
You are an expert at extracting structured data from freight dispatch invoices.

The document is an invoice with:
- A "Bill To:" section (carrier/company name)
- Invoice #, Date, Due Date
- A table with columns: Pickup Date, Delivery Date, Origin, Destination, Price, Rate, Amount
- Loads are grouped by driver: each section starts with "Driver: <name>" and then has multiple load rows
- Subtotal, Postage, Total, Balance Due at the end
- A "Payable To:" section (dispatcher/payable entity)

Extract everything into a single JSON object with this exact structure. Use only the field names below.

- carrierName (string): The company name under "Bill To:"
- invoiceNumber (string): e.g. "INV-2025-0001"
- invoiceDate (string): Invoice date in YYYY-MM-DD
- dueDate (string): Due date in YYYY-MM-DD
- balanceDue (number): Balance due amount
- subtotal (number): Subtotal amount
- postage (number): Postage amount, use 0 if missing
- total (number): Total amount
- billTo (object): {{ "name": carrier name, "cityStateZip": "", "phone": "" }} (extract address/phone if present)
- payableTo (object): {{ "name": payable-to name, "cityStateZip": "", "phone": "" }}
- groups (array): One object per driver section. Each object has:
  - groupLabel (string): The driver name (e.g. "Bigneer", "Maykel")
  - groupRate (string): The rate for that section, e.g. "5%"
  - lines (array): One object per load row under that driver. Each line has:
    - pickupDate (string): MM/DD/YYYY or YYYY-MM-DD
    - deliveryDate (string): MM/DD/YYYY or YYYY-MM-DD
    - originCityState (string): e.g. "Houston, TX"
    - destCityState (string): e.g. "WESTON, WV"
    - price (string): The load price as string, e.g. "3200.00"
    - ratePercent (string): e.g. "5%"
    - amount (string): The line amount as string, e.g. "160.00"

Ensure every load row from the table is in the correct driver's lines array. Dates can be returned as MM/DD/YYYY or YYYY-MM-DD.
Return only valid JSON, no markdown or explanation.

Raw invoice text:
{raw_text[:30000]}

Return the JSON object only.
"""

    try:
        response = gemini_generate_content_with_retry(model, prompt)
        if not response:
            return None
        if not getattr(response, "candidates", None):
            print(
                f"Gemini old-invoice: no candidates (blocked or empty). "
                f"prompt_feedback={getattr(response, 'prompt_feedback', None)!r}"
            )
            return None
        if not response.text:
            return None
        cleaned = _clean_json_response(response.text)
        if not cleaned:
            return None
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return None
        # Normalize into expected shape
        return _normalize_gemini_output(data)
    except json.JSONDecodeError:
        return None
    except Exception as e:
        print(f"Gemini old-invoice extraction failed (after retries): {e!r}")
        return None


def _normalize_gemini_output(data: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure output has the exact keys and types the API expects."""
    def num(v):
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).strip().replace("$", "").replace(",", "")
        try:
            return float(s)
        except ValueError:
            return None

    def str_or_empty(v):
        return str(v).strip() if v is not None else ""

    bill_to = data.get("billTo")
    if not isinstance(bill_to, dict):
        bill_to = {}
    payable_to = data.get("payableTo")
    if not isinstance(payable_to, dict):
        payable_to = {}

    groups = data.get("groups")
    if not isinstance(groups, list):
        groups = []
    out_groups = []
    for g in groups:
        if not isinstance(g, dict):
            continue
        lines = g.get("lines")
        if not isinstance(lines, list):
            lines = []
        out_lines = []
        for line in lines:
            if not isinstance(line, dict):
                continue
            out_lines.append({
                "pickupDate": str_or_empty(line.get("pickupDate")),
                "deliveryDate": str_or_empty(line.get("deliveryDate")),
                "originCityState": str_or_empty(line.get("originCityState")),
                "destCityState": str_or_empty(line.get("destCityState")),
                "price": str_or_empty(line.get("price")),
                "ratePercent": str_or_empty(line.get("ratePercent")),
                "amount": str_or_empty(line.get("amount")),
            })
        out_groups.append({
            "groupLabel": str_or_empty(g.get("groupLabel")),
            "groupRate": str_or_empty(g.get("groupRate")),
            "lines": out_lines,
        })

    return {
        "carrierName": str_or_empty(data.get("carrierName")),
        "invoiceNumber": str_or_empty(data.get("invoiceNumber")),
        "invoiceDate": str_or_empty(data.get("invoiceDate")),
        "dueDate": str_or_empty(data.get("dueDate")),
        "balanceDue": num(data.get("balanceDue")),
        "subtotal": num(data.get("subtotal")),
        "postage": num(data.get("postage")) if data.get("postage") is not None else 0.0,
        "total": num(data.get("total")),
        "billTo": {
            "name": str_or_empty(bill_to.get("name") or data.get("carrierName")),
            "cityStateZip": str_or_empty(bill_to.get("cityStateZip")),
            "phone": str_or_empty(bill_to.get("phone")),
        },
        "payableTo": {
            "name": str_or_empty(payable_to.get("name")),
            "cityStateZip": str_or_empty(payable_to.get("cityStateZip")),
            "phone": str_or_empty(payable_to.get("phone")),
        },
        "groups": out_groups,
    }


def main():
    import sys
    if len(sys.argv) < 2:
        print("Usage: python gemini_extract_old_invoice.py <path_to_pdf_or_text_file>")
        sys.exit(1)
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"File not found: {path}")
        sys.exit(1)
    raw_text = None
    if path.lower().endswith(".pdf"):
        from extract_old_invoice import extract_text_from_pdf
        raw_text = extract_text_from_pdf(path)
    else:
        with open(path, "r", encoding="utf-8") as f:
            raw_text = f.read()
    if not raw_text or len(raw_text.strip()) < 50:
        print("No text to extract.")
        sys.exit(1)
    result = extract_old_invoice_with_gemini(raw_text)
    if result:
        print(json.dumps(result, indent=2))
    else:
        print("{}")
        sys.exit(1)


if __name__ == "__main__":
    main()
