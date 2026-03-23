#!/usr/bin/env python3
"""
Gemini-based extraction of key fields (dates, locations, rates) from rate confirmation documents.
Uses Google Gemini 2.0 Flash API to analyze the full raw_text and extract structured data.
"""

import json
import os
import time
from pathlib import Path
from typing import Dict, Optional
import google.generativeai as genai

from ai_helpers import gemini_generate_content_with_retry

def setup_gemini():
    """Initialize Gemini API with credentials."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GEMINI_API_KEY not found in environment variables.")
        print("Please set it with: $env:GEMINI_API_KEY='your-api-key'")
        print("Get your free API key at: https://makersuite.google.com/app/apikey")
        return None
    
    genai.configure(api_key=api_key)
    # Use gemini-2.5-flash (correct model name)
    return genai.GenerativeModel('gemini-2.5-flash')

def extract_data_with_gemini(model, raw_text: str) -> Optional[Dict]:
    """Sends raw text to Gemini and extracts structured data."""
    if not model:
        return None

    prompt = f"""
    You are an expert at extracting key information from freight rate confirmation documents.
    Extract the following fields from the provided raw text:
    - pickup_date (format: MM/DD/YYYY)
    - delivery_date (format: MM/DD/YYYY)
    - origin (City, State format, e.g., "Houston, TX")
    - destination (City, State format, e.g., "Fort Lupton, CO")
    - amount (numeric value, e.g., 3200.00)
    - reference_number (load number, pro number, trip number, or similar identifier - extract as string)
    - company_name (carrier name, company name, or carrier company - extract the full company/carrier name)
    - driver_name (driver name, primary driver, or driver - extract the driver's name as a string)

    If a field is not found, return "NOT_FOUND".
    Ensure dates are valid and delivery_date is on or after pickup_date. If not, adjust delivery_date to be pickup_date + 2 days.
    The amount should be between $100 and $8000. If outside this range, return "NOT_FOUND".
    For reference_number, look for fields like "Load #", "Load Number", "PRO#", "Trip #", "Trip Number", "Reference #", etc.
    For company_name, look for "Carrier Name", "Company", "Carrier", or the company name in the document header.
    For driver_name, look for "Driver Name", "Primary Driver", "Driver", or similar fields.

    Raw Text:
    {raw_text}

    Return the extracted data as a JSON object.
    Example:
    {{
      "pickup_date": "09/23/2025",
      "delivery_date": "09/25/2025",
      "origin": "Houston, TX",
      "destination": "Fort Lupton, CO",
      "amount": 3200.00,
      "reference_number": "125835484",
      "company_name": "BLUELIGHT TRANSPORT LLC",
      "driver_name": "Reynier"
    }}
    """
    
    try:
        response = gemini_generate_content_with_retry(model, prompt)

        # Blocked or empty candidates (safety / policy)
        if not getattr(response, "candidates", None):
            pf = getattr(response, "prompt_feedback", None)
            print(f"ERROR: No candidates from Gemini (blocked or empty). prompt_feedback={pf!r}")
            return None

        # Debug: Print the raw response (commented out for production)
        # print(f"DEBUG - Raw response: '{response.text}'")

        if not response.text or response.text.strip() == "":
            print("ERROR: Empty response text from Gemini")
            return None
        
        # Clean the response - remove markdown code blocks if present
        cleaned_response = response.text.strip()
        if cleaned_response.startswith('```json'):
            cleaned_response = cleaned_response[7:]  # Remove ```json
        if cleaned_response.startswith('```'):
            cleaned_response = cleaned_response[3:]   # Remove ```
        if cleaned_response.endswith('```'):
            cleaned_response = cleaned_response[:-3]  # Remove trailing ```
        cleaned_response = cleaned_response.strip()
            
        # Try to parse JSON
        extracted_json = json.loads(cleaned_response)
        return extracted_json
        
    except json.JSONDecodeError as e:
        print(f"JSON Parse Error: {e}")
        print(f"Response was: '{getattr(response, 'text', '')}'")
        return None
    except Exception as e:
        print(f"Error during Gemini extraction (after retries): {e}")
        return None

def main():
    """Processes all JSON files using Gemini for extraction."""
    model = setup_gemini()
    if not model:
        return

    # Get all JSON files from processed_data directory (NEW rate confirmations)
    script_dir = Path(__file__).parent
    processed_data_dir = script_dir / "processed_data"
    json_files = list(processed_data_dir.glob("*.json"))
    json_files = [f for f in json_files if f.name != "rate_confirmation_summary.json"]
    json_files.sort()
    
    print(f"Processing {len(json_files)} files with Gemini 2.5 Flash...")
    print("=" * 80)
    
    # Process all files
    for json_file in json_files:
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            raw_text = data.get('raw_text', '')
            if not raw_text:
                print(f"[NO RAW TEXT] {json_file.name}")
                continue
            
            extracted_data = extract_data_with_gemini(model, raw_text)
            
            if extracted_data:
                updated = False
                # Update fields if extracted and not "NOT_FOUND"
                for field in ['pickup_date', 'delivery_date', 'origin', 'destination', 'amount', 'reference_number', 'company_name', 'driver_name']:
                    if field in extracted_data and extracted_data[field] != "NOT_FOUND":
                        if data.get(field) != extracted_data[field]:
                            print(f"[UPDATE] {json_file.name}: {field}: {data.get(field)} -> {extracted_data[field]}")
                            data[field] = extracted_data[field]
                            updated = True
                
                if updated:
                    with open(json_file, 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                else:
                    print(f"[OK] {json_file.name} (no changes)")
            else:
                print(f"[ERROR] {json_file.name}: Gemini extraction failed.")
            
            time.sleep(1) # To respect API rate limits (15 req/min)
                
        except Exception as e:
            print(f"[ERROR] processing {json_file}: {e}")
            
    print("=" * 80)
    print("Gemini extraction complete.")

if __name__ == "__main__":
    main()
