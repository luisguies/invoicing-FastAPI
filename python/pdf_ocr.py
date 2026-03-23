#!/usr/bin/env python3
"""
PDF OCR service using OpenAI Vision API to extract load data from PDF files.
"""

import os
import json
from pdf2image import convert_from_path
from openai import OpenAI
from typing import Dict, Optional, List

from ai_helpers import openai_responses_create_with_retry
import base64
from io import BytesIO
import pdfplumber
from pathlib import Path

# Initialize OpenAI client (longer timeout for vision + structured output)
_OPENAI_TIMEOUT = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "120"))
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    timeout=_OPENAI_TIMEOUT,
)

# JSON Schema for structured output
RATE_CON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["carrier", "load_number", "pickup", "delivery", "rate_total", "needs_review", "warnings"],
    "properties": {
        "carrier": {"type": ["string", "null"]},
        "load_number": {"type": ["string", "null"]},
        "pickup": {
            "type": "object",
            "additionalProperties": False,
            "required": ["city", "state", "date"],
            "properties": {
                "city": {"type": ["string", "null"]},
                "state": {"type": ["string", "null"]},
                "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"}
            }
        },
        "delivery": {
            "type": "object",
            "additionalProperties": False,
            "required": ["city", "state", "date"],
            "properties": {
                "city": {"type": ["string", "null"]},
                "state": {"type": ["string", "null"]},
                "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"}
            }
        },
        "rate_total": {"type": ["number", "null"]},
        "needs_review": {"type": "boolean"},
        "warnings": {"type": "array", "items": {"type": "string"}}
    }
}

def extract_json_from_response(response):
    """
    Extract a JSON object from an OpenAI Responses API response.
    Supports typed SDK objects and dict-like payloads, including non-output_text blocks.
    """
    def _get(obj, key, default=None):
        if obj is None:
            return default
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    def _extract_json_from_text(text_value):
        if not text_value or not isinstance(text_value, str):
            return None
        candidate = text_value.strip()
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(candidate[start:end + 1])
        except Exception:
            return None

    # 0) If the SDK successfully parsed structured output, trust it.
    parsed = _get(response, "output_parsed")
    if parsed:
        return parsed

    # 1) Some responses include top-level output_text.
    direct_text = _get(response, "output_text")
    parsed_from_direct_text = _extract_json_from_text(direct_text)
    if parsed_from_direct_text is not None:
        return parsed_from_direct_text

    # 2) Walk output items/content and collect any text-like content.
    texts = []
    saw_refusal_only_candidate = False
    output_items = _get(response, "output", []) or []
    for item in output_items:
        item_type = _get(item, "type")

        # Item-level text
        item_text = _get(item, "text")
        if isinstance(item_text, str) and item_text.strip():
            texts.append(item_text)

        # Content blocks under message/output entries
        content_blocks = _get(item, "content", []) or []
        refusal_blocks = 0
        non_refusal_blocks = 0
        for block in content_blocks:
            block_type = _get(block, "type")
            # Common text blocks seen in Responses API variants
            if block_type in ("output_text", "text", "refusal", "error"):
                if block_type == "refusal":
                    refusal_blocks += 1
                else:
                    non_refusal_blocks += 1
                block_text = _get(block, "text") or _get(block, "refusal") or _get(block, "message")
                if isinstance(block_text, str) and block_text.strip():
                    texts.append(block_text)

        if refusal_blocks and not non_refusal_blocks and not item_text:
            saw_refusal_only_candidate = True

        # Some errors are represented at item level
        if item_type == "error":
            err_msg = _get(item, "message")
            if isinstance(err_msg, str) and err_msg.strip():
                texts.append(err_msg)
        if item_type == "refusal":
            saw_refusal_only_candidate = True

    combined = "\n".join(texts).strip()
    if not combined:
        if saw_refusal_only_candidate:
            print("OpenAI returned a policy refusal or empty output; no JSON to parse.")
        return None

    parsed = _extract_json_from_text(combined)
    if parsed is None and saw_refusal_only_candidate:
        print("OpenAI output included a refusal or non-JSON response; treating as extraction failure.")
    return parsed




def pdf_to_images(pdf_path: str) -> List:
    """
    Convert PDF pages to images.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        List of PIL Image objects
    """
    try:
        images = convert_from_path(pdf_path)
        return images
    except Exception as e:
        raise Exception(f"Error converting PDF to images: {str(e)}")


def image_to_base64(image) -> str:
    """
    Convert PIL Image to base64 string.
    
    Args:
        image: PIL Image object
        
    Returns:
        Base64 encoded string
    """
    buffered = BytesIO()
    image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return img_str


def extract_text_from_pdf(pdf_path: str) -> Optional[str]:
    """
    Extract text from a PDF file.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        Extracted text as string, or None if extraction fails
    """
    try:
        text_content = []
        with pdfplumber.open(pdf_path) as pdf:
            # Extract text from all pages
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    text_content.append(text)
        
        if text_content:
            return "\n".join(text_content)
        return None
    except Exception as e:
        print(f"Error extracting text from PDF: {str(e)}")
        return None


def is_text_based_pdf(text: str) -> bool:
    """
    Determine if a PDF is text-based by checking if we got meaningful text.
    
    Args:
        text: Extracted text from PDF
        
    Returns:
        True if PDF appears to be text-based, False otherwise
    """
    if not text:
        return False
    
    # Check if we have a reasonable amount of text (at least 100 characters)
    # and it contains some recognizable patterns
    if len(text.strip()) < 100:
        return False
    
    # Check for common invoice/load document keywords
    keywords = ['load', 'carrier', 'pickup', 'delivery', 'date', 'rate', 'confirmation', 
                'invoice', 'number', 'pay', 'amount', 'city', 'state']
    text_lower = text.lower()
    keyword_count = sum(1 for keyword in keywords if keyword in text_lower)
    
    # If we found at least 3 keywords, it's likely text-based
    return keyword_count >= 3


def get_safe_default() -> Dict:
    """
    Return a safe default object with needs_review = true when structured output fails.
    
    Returns:
        Dictionary in legacy format with all fields set to None and needs_review = True
    """
    return {
        "carrier_name": None,
        "load_number": None,
        "pickup_date": None,
        "delivery_date": None,
        "pickup_city": None,
        "pickup_state": None,
        "delivery_city": None,
        "delivery_state": None,
        "carrier_pay": None,
        "needs_review": True,
        "warnings": ["Structured output failed"]
    }


def get_safe_default_ai_failure(reason: str, detail: str = "") -> Dict:
    """
    Same as get_safe_default but with explicit AI timeout / API error / refusal messaging
    for operators and the review queue.
    """
    out = get_safe_default()
    warnings = [f"AI extraction failed: {reason}"]
    if detail:
        warnings.append(str(detail)[:500])
    out["warnings"] = warnings
    return out


def is_extraction_failed(data: Dict) -> bool:
    """
    Check if extraction failed - meaning we got a safe default or insufficient data.
    
    Args:
        data: Extracted data in legacy format
        
    Returns:
        True if extraction failed, False if we have useful data
    """
    if not data:
        return True

    # In the Node upload route, pickup_date + delivery_date are required to create a load.
    # Treat missing dates as extraction failure so we can run fallbacks.
    has_pickup_date = data.get("pickup_date") not in (None, "", "NOT_FOUND")
    has_delivery_date = data.get("delivery_date") not in (None, "", "NOT_FOUND")
    return not (has_pickup_date and has_delivery_date)


def _gemini_json_to_legacy(extracted_json: Dict, warnings_prefix: str) -> Dict:
    """
    Convert Gemini extracted JSON (from gemini_extract_key_fields.py) into our legacy dict.
    """
    def parse_date(date_str: str) -> Optional[str]:
        """Convert MM/DD/YYYY to YYYY-MM-DD"""
        if not date_str or date_str == "NOT_FOUND":
            return None
        try:
            from datetime import datetime
            dt = datetime.strptime(date_str, "%m/%d/%Y")
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return None

    def parse_location(loc_str: str) -> tuple:
        """Parse 'City, State' into (city, state)"""
        if not loc_str or loc_str == "NOT_FOUND":
            return (None, None)
        try:
            parts = loc_str.split(",")
            if len(parts) >= 2:
                city = parts[0].strip()
                state = parts[1].strip()
                return (city, state)
        except Exception:
            pass
        return (None, None)

    origin_city, origin_state = parse_location(extracted_json.get("origin", "NOT_FOUND"))
    dest_city, dest_state = parse_location(extracted_json.get("destination", "NOT_FOUND"))

    legacy_data = {
        "carrier_name": extracted_json.get("company_name") if extracted_json.get("company_name") != "NOT_FOUND" else None,
        "driver_name": extracted_json.get("driver_name") if extracted_json.get("driver_name") != "NOT_FOUND" else None,
        "load_number": extracted_json.get("reference_number") if extracted_json.get("reference_number") != "NOT_FOUND" else None,
        "carrier_pay": extracted_json.get("amount") if extracted_json.get("amount") != "NOT_FOUND" else None,
        "pickup_date": parse_date(extracted_json.get("pickup_date", "NOT_FOUND")),
        "delivery_date": parse_date(extracted_json.get("delivery_date", "NOT_FOUND")),
        "pickup_city": origin_city,
        "pickup_state": origin_state,
        "delivery_city": dest_city,
        "delivery_state": dest_state,
        "needs_review": False,
        "warnings": [warnings_prefix],
    }
    return legacy_data


def extract_with_gemini(raw_text: str) -> Optional[Dict]:
    """
    Fallback: Use python/gemini_extract_key_fields.py to extract structured fields from raw_text.
    """
    try:
        import gemini_extract_key_fields as gekf

        model = gekf.setup_gemini()
        if not model:
            return None

        extracted = gekf.extract_data_with_gemini(model, raw_text)
        if not extracted or not isinstance(extracted, dict):
            return None

        return _gemini_json_to_legacy(extracted, "Extracted using gemini_extract_key_fields fallback")

    except ImportError as e:
        print(f"Gemini fallback import error: {e}")
        return None
    except Exception as e:
        print(f"Error in Gemini fallback: {e}")
        import traceback
        traceback.print_exc()
        return None


def extract_with_google_vision(pdf_path: str) -> Optional[Dict]:
    """
    Fallback 1: Use python/google_vision_pipeline.py to OCR the PDF (Google Vision),
    then python/gemini_extract_key_fields.py to extract fields from the OCR text.
    
    Args:
        pdf_path: Path to PDF file
        
    Returns:
        Dictionary in legacy format, or None if extraction fails
    """
    try:
        from pathlib import Path
        from google.cloud import vision
        import google_vision_pipeline as gvp

        # If GOOGLE_APPLICATION_CREDENTIALS isn't set, auto-detect a key in ./keys/
        # (compose mounts ./python -> /app, so keys usually live at /app/keys/*.json)
        if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            keys_dir = Path(__file__).parent / "keys"
            if keys_dir.exists():
                json_files = sorted(keys_dir.glob("*.json"))
                if json_files:
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(json_files[0])
                    print(f"Using Google credentials from: {os.environ['GOOGLE_APPLICATION_CREDENTIALS']}")

        client = vision.ImageAnnotatorClient()
        raw_text = gvp.process_pdf_with_vision(Path(pdf_path), client)
        if not raw_text or not raw_text.strip():
            return None

        legacy = extract_with_gemini(raw_text)
        if legacy and isinstance(legacy, dict):
            # annotate source
            legacy.setdefault("warnings", [])
            legacy["warnings"].append("OCR_text_source=google_vision_pipeline")
        return legacy

    except ImportError as e:
        print(f"Google Vision fallback import error: {e}")
        return None
    except Exception as e:
        print(f"Error in Google Vision + Gemini fallback: {e}")
        import traceback
        traceback.print_exc()
        return None


def convert_to_legacy_format(data: Dict) -> Dict:
    """
    Convert the new schema format to the legacy format expected by the rest of the system.
    
    Args:
        data: Data in new schema format (carrier, load_number, pickup, delivery, rate_total, etc.)
        
    Returns:
        Dictionary in legacy format (carrier_name, driver_name, load_number, carrier_pay, etc.)
    """
    try:
        # Handle both new schema and legacy format
        if "carrier_name" in data:
            # Already in legacy format
            return data
        
        legacy = {
            "carrier_name": data.get("carrier"),
            "driver_name": None,  # Not in new schema, will be extracted separately if needed
            "load_number": data.get("load_number"),
            "carrier_pay": data.get("rate_total"),
            "pickup_date": data.get("pickup", {}).get("date") if isinstance(data.get("pickup"), dict) else None,
            "delivery_date": data.get("delivery", {}).get("date") if isinstance(data.get("delivery"), dict) else None,
            "pickup_city": data.get("pickup", {}).get("city") if isinstance(data.get("pickup"), dict) else None,
            "pickup_state": data.get("pickup", {}).get("state") if isinstance(data.get("pickup"), dict) else None,
            "delivery_city": data.get("delivery", {}).get("city") if isinstance(data.get("delivery"), dict) else None,
            "delivery_state": data.get("delivery", {}).get("state") if isinstance(data.get("delivery"), dict) else None,
            "needs_review": data.get("needs_review", False),
            "warnings": data.get("warnings", [])
        }
        return legacy
    except Exception as e:
        print(f"Error converting to legacy format: {str(e)}")
        return data  # Return original if conversion fails


def extract_load_data_from_text(text: str) -> Dict:
    try:
        prompt = """Extract the following information from this rate confirmation/load document text:
        - carrier: The name of the carrier
        - load_number: The load number or reference
        - pickup: First pickup location (city, state) and date (YYYY-MM-DD)
        - delivery: Final delivery location (city, state) and date (YYYY-MM-DD)
        - rate_total: The total rate or carrier pay amount (as a number)
        - needs_review: Set to true if the document is unclear or data seems incorrect
        - warnings: Array of any warnings or issues found (e.g., "Multiple pickups found, using first", "Date format unclear")

        If there are multiple pickups, use only the FIRST pickup date and location.
        If there are multiple deliveries, use only the FINAL delivery date and location.

        Document text:
        """ + text[:8000]

        model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
        if not os.getenv("OPENAI_API_KEY"):
            print("Warning: OPENAI_API_KEY environment variable is not set")
            return get_safe_default()

        print(f"Calling OpenAI Responses API with model: {model} (structured outputs)")

        response = openai_responses_create_with_retry(
            client,
            model=model,
            # Force actual text output
            modalities=["text"],
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "ratecon_extract",
                    "schema": RATE_CON_SCHEMA,
                    "strict": False,  # IMPORTANT: don’t brick on minor schema drift
                }
            },
            max_output_tokens=700,
        )

        data = extract_json_from_response(response)
        if data:
            return convert_to_legacy_format(data)

        print("No usable OCR output; returning AI failure default")
        return get_safe_default_ai_failure(
            "empty_or_unparseable_response",
            "Model returned no usable JSON (timeout, refusal, or malformed output after retries).",
        )

    except Exception as e:
        print(f"Error extracting data from text: {str(e)}")
        import traceback
        traceback.print_exc()
        return get_safe_default_ai_failure("openai_api_error", str(e))


def extract_load_data_from_image(image) -> Dict:
    try:
        base64_image = image_to_base64(image)

        prompt = """Extract the following information from this rate confirmation/load document:
- carrier
- load_number
- pickup: {city, state, date}
- delivery: {city, state, date}
- rate_total
- needs_review
- warnings

Use FIRST pickup and FINAL delivery if multiple stops exist.
Return JSON only.
"""

        model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
        if not os.getenv("OPENAI_API_KEY"):
            print("OPENAI_API_KEY not set")
            return get_safe_default()

        image_url = f"data:image/png;base64,{base64_image}"

        # Some OpenAI SDK versions don't support the `modalities` argument.
        # We'll avoid it for compatibility.
        response = openai_responses_create_with_retry(
            client,
            model=model,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_image",
                        "image_url": {"url": image_url},
                    },
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "ratecon_extract",
                    "schema": RATE_CON_SCHEMA,
                    "strict": False,
                }
            },
            max_output_tokens=2000,
        )

        data = extract_json_from_response(response)
        if data:
            return convert_to_legacy_format(data)

        print("OpenAI image OCR returned no usable JSON")
        print("DEBUG output_text:", getattr(response, "output_text", None))
        print("DEBUG output item types:", [getattr(x, "type", None) for x in getattr(response, "output", []) or []])
        return get_safe_default_ai_failure(
            "empty_or_unparseable_response",
            "Vision model returned no usable JSON (timeout, refusal, or malformed output after retries).",
        )

    except Exception as e:
        print(f"Error extracting data from image: {str(e)}")
        import traceback
        traceback.print_exc()
        return get_safe_default_ai_failure("openai_vision_error", str(e))



def process_pdf(pdf_path: str) -> Dict:
    """
    Process a PDF file and extract load data.
    Tries text extraction first, then OCRs multiple pages.
    Falls back to Google Vision + Gemini if OpenAI fails.
    Returns LEGACY format (carrier_name, pickup_date, delivery_date, etc).
    """
    try:
        if not os.path.exists(pdf_path):
            raise Exception(f"PDF file not found: {pdf_path}")

        print("Attempting text extraction...")
        extracted_text = extract_text_from_pdf(pdf_path)

        if extracted_text and is_text_based_pdf(extracted_text):
            print("PDF appears text-based. Extracting from text...")
            # This returns legacy format
            openai_result = extract_load_data_from_text(extracted_text)
            
            # Check if OpenAI extraction failed
            if not is_extraction_failed(openai_result):
                return openai_result
            else:
                print("OpenAI extraction failed, trying fallbacks...")
        else:
            print("Converting PDF to images for OCR...")
            images = pdf_to_images(pdf_path)

            if not images:
                print("No pages found in PDF")
                # Try fallbacks even if no images
                openai_result = get_safe_default()
            else:
                def score_legacy(d: Dict) -> int:
                    s = 0
                    if d.get("carrier_name"): s += 1
                    if d.get("load_number"): s += 1
                    if d.get("carrier_pay") not in (None, "", 0): s += 1
                    if d.get("pickup_date"): s += 3
                    if d.get("delivery_date"): s += 3
                    if d.get("pickup_city"): s += 1
                    if d.get("delivery_city"): s += 1
                    return s

                best = None
                best_score = -1

                print(f"OCR processing {len(images)} page(s)...")

                for i, img in enumerate(images):
                    print(f"OCR page {i + 1}/{len(images)}")
                    data = extract_load_data_from_image(img)  # legacy dict

                    # tag which page produced it
                    if data.get("warnings") is None:
                        data["warnings"] = []
                    data["warnings"].append(f"OCR_used_page={i + 1}")

                    s = score_legacy(data)
                    if s > best_score:
                        best = data
                        best_score = s

                    # Early exit: once both dates are present
                    if data.get("pickup_date") and data.get("delivery_date"):
                        print(f"Found pickup+delivery on page {i + 1}; stopping early.")
                        best = data
                        break

                openai_result = best if best else get_safe_default()
        
        # Check if OpenAI extraction failed, then try fallbacks
        print(f"Checking if extraction failed... OpenAI result: needs_review={openai_result.get('needs_review')}, has_pickup={bool(openai_result.get('pickup_date'))}, has_delivery={bool(openai_result.get('delivery_date'))}, has_carrier={bool(openai_result.get('carrier_name'))}")
        
        if is_extraction_failed(openai_result):
            print("OpenAI extraction failed or insufficient data. Trying fallback 1: Google Vision + Gemini...")
            
            # Fallback 1: Google Vision + Gemini
            try:
                google_vision_result = extract_with_google_vision(pdf_path)
                if google_vision_result and not is_extraction_failed(google_vision_result):
                    print("Google Vision + Gemini fallback succeeded!")
                    return google_vision_result
                else:
                    print(f"Google Vision + Gemini fallback failed. Result: {google_vision_result}")
            except Exception as e:
                print(f"Google Vision + Gemini fallback error: {e}")
                import traceback
                traceback.print_exc()
            
            # Fallback 2: Gemini only (if we have raw text)
            print("Trying fallback 2: Gemini only...")
            if extracted_text:
                try:
                    gemini_result = extract_with_gemini(extracted_text)
                    if gemini_result and not is_extraction_failed(gemini_result):
                        print("Gemini fallback succeeded!")
                        return gemini_result
                    else:
                        print(f"Gemini fallback failed. Result: {gemini_result}")
                except Exception as e:
                    print(f"Gemini fallback error: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print("No extracted text available for Gemini fallback. Trying to extract text from PDF for Gemini...")
                # Try to extract text again for Gemini fallback
                try:
                    fallback_text = extract_text_from_pdf(pdf_path)
                    if fallback_text:
                        gemini_result = extract_with_gemini(fallback_text)
                        if gemini_result and not is_extraction_failed(gemini_result):
                            print("Gemini fallback (with re-extracted text) succeeded!")
                            return gemini_result
                except Exception as e:
                    print(f"Gemini fallback (with re-extracted text) error: {e}")
            
            print("All fallbacks failed. Returning OpenAI result (may need review).")
            return openai_result
        else:
            return openai_result

    except Exception as e:
        print(f"Error processing PDF: {e}")
        import traceback
        traceback.print_exc()
        return get_safe_default()



if __name__ == "__main__":
    # Test the OCR service
    import sys
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        result = process_pdf(pdf_path)
        print(json.dumps(result, indent=2))
    else:
        print("Usage: python pdf_ocr.py <pdf_path>")

