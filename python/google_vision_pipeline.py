#!/usr/bin/env python3
"""
Google Cloud Vision API pipeline:
- Process PDFs from Rate Confirmations/ using Google Vision API
- Convert to our JSON schema and write to processed_data/
- Run enrichment scripts: update_company_names, add_driver_names, update_reference_numbers
- Run consolidation grouped by company and driver

Setup:
1. Install: pip install google-cloud-vision google-cloud-storage
2. Set up authentication (see below)
3. Set environment variables or use CLI flags

Authentication options:
- Service account key file: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
- Or set GOOGLE_CLOUD_PROJECT and use gcloud auth application-default login
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Dict, Any, List
import fitz  # PyMuPDF for PDF to image conversion

from google.cloud import vision
from google.cloud import storage
from google.cloud.exceptions import GoogleCloudError

RATE_CONFIRM_DIR = Path("Rate Confirmations")
OUTPUT_DIR = Path("processed_data")


def parse_args():
    parser = argparse.ArgumentParser(description="Run Google Vision OCR pipeline")
    parser.add_argument("--project", default=os.getenv("GOOGLE_CLOUD_PROJECT"), help="Google Cloud project ID")
    parser.add_argument("--bucket", default=os.getenv("VISION_BUCKET", ""), help="GCS bucket for PDFs (optional)")
    parser.add_argument("--only_new", action="store_true", help="Process only PDFs not yet present in processed_data/")
    parser.add_argument("--credentials", default=os.getenv("GOOGLE_APPLICATION_CREDENTIALS"), help="Path to service account key file")
    return parser.parse_args()


def list_local_pdfs() -> List[Path]:
    if not RATE_CONFIRM_DIR.exists():
        return []
    return [p for p in RATE_CONFIRM_DIR.iterdir() if p.suffix.lower() == ".pdf"]


def already_processed(pdf_path: Path) -> bool:
    """Check if there's a corresponding _data.json in processed_data for this PDF."""
    target = OUTPUT_DIR / f"{pdf_path.stem}_data.json"
    return target.exists()


def pdf_to_images(pdf_path: Path) -> List[bytes]:
    """Convert PDF pages to images (bytes) for Google Vision API."""
    try:
        doc = fitz.open(pdf_path)
        images = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            # Convert to image with high DPI for better OCR
            mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better quality
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("png")
            images.append(img_data)
        
        doc.close()
        return images
    except Exception as e:
        print(f"Error converting PDF to images: {e}")
        return []


def process_pdf_with_vision(pdf_path: Path, client: vision.ImageAnnotatorClient) -> str:
    """Process a PDF file with Google Vision API by converting to images first."""
    try:
        # Convert PDF to images
        images = pdf_to_images(pdf_path)
        if not images:
            return ""
        
        all_text = []
        
        # Process each page image
        for i, img_data in enumerate(images):
            # Create image object
            image = vision.Image(content=img_data)
            
            # Perform text detection
            response = client.text_detection(image=image)
            texts = response.text_annotations
            
            if texts:
                # The first text annotation contains all detected text for this page
                page_text = texts[0].description
                if page_text.strip():
                    all_text.append(f"--- Page {i+1} ---\n{page_text}")
            
        return "\n\n".join(all_text)
            
    except GoogleCloudError as e:
        print(f"Google Vision API error processing {pdf_path}: {e}")
        return ""
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
        return ""


def process_pdf_with_vision_gcs(pdf_path: Path, client: vision.ImageAnnotatorClient, bucket_name: str) -> str:
    """Process a PDF file with Google Vision API using GCS (for larger files)."""
    try:
        # Upload to GCS first
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob_name = f"rate-confirmations/{pdf_path.name}"
        blob = bucket.blob(blob_name)
        
        print(f"Uploading {pdf_path} to gs://{bucket_name}/{blob_name}")
        blob.upload_from_filename(str(pdf_path))
        
        # Create image object with GCS URI
        image = vision.Image()
        image.source.image_uri = f"gs://{bucket_name}/{blob_name}"
        
        # Perform text detection
        response = client.text_detection(image=image)
        texts = response.text_annotations
        
        # Clean up - delete the uploaded file
        blob.delete()
        
        if texts:
            return texts[0].description
        else:
            return ""
            
    except GoogleCloudError as e:
        print(f"Google Vision API error processing {pdf_path}: {e}")
        return ""
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
        return ""


def infer_fields_from_filename(pdf_name: str) -> Dict[str, Any]:
    # Example: Rate Con - TNT - Pasadena TX to Lake Charles LA - Dilmar - U6012795.pdf
    base = pdf_name.replace(".pdf", "")
    parts = base.split(" - ")
    extracted = {
        "filename": pdf_name,
        "company_name": "NOT_FOUND",
        "reference_number": "NOT_FOUND",
    }
    if len(parts) >= 2:
        extracted["company_alias"] = parts[1]
    if len(parts) >= 4:
        extracted["driver_name"] = parts[-2]
    if len(parts) >= 5:
        extracted["reference_number"] = parts[-1]
    return extracted


def make_initial_json(pdf_path: Path, raw_text: str) -> Dict[str, Any]:
    info = infer_fields_from_filename(pdf_path.name)
    data = {
        "filename": pdf_path.name,
        "company_name": info.get("company_name", "NOT_FOUND"),
        "date": "NOT_FOUND",
        "amount": None,
        "currency": "USD",
        "reference_number": info.get("reference_number", "NOT_FOUND"),
        "pickup_date": "NOT_FOUND",
        "delivery_date": "NOT_FOUND",
        "origin": "NOT_FOUND",
        "destination": "NOT_FOUND",
        "commodity": "NOT_FOUND",
        "weight": "NOT_FOUND",
        "equipment_type": "",
        "rate_per_mile": "NOT_FOUND",
        "total_miles": "NOT_FOUND",
        "accessorials": [],
        "special_instructions": [],
        "contact_info": {},
        "processing_timestamp": __import__('datetime').datetime.now().isoformat(),
        "confidence_score": 90.0,
        "raw_text": raw_text,
    }
    # prefill driver from filename if available
    if "driver_name" in info:
        data["driver_name"] = info["driver_name"]
    return data


def write_json(pdf_path: Path, data: Dict[str, Any]):
    OUTPUT_DIR.mkdir(exist_ok=True)
    out_path = OUTPUT_DIR / f"{pdf_path.stem}_data.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return out_path


def run_local_enrichment():
    """Run the existing local enrichment scripts in sequence."""
    import subprocess
    scripts = [
        "update_company_names.py",
        "add_driver_names.py",
        "update_reference_numbers.py",
        "consolidate_by_company.py",
    ]
    for script in scripts:
        script_path = Path(script)
        if not script_path.exists():
            print(f"[SKIP] {script} not found, skipping...")
            continue
        try:
            cmd = [sys.executable, script]
            print(f"[RUN] {script}...")
            subprocess.check_call(cmd)
            print(f"[OK] {script} completed")
        except subprocess.CalledProcessError as e:
            print(f"[ERROR] Command failed: {' '.join(cmd)} -> {e}")
            # Continue with other scripts instead of raising
            continue


def main():
    args = parse_args()

    # Auto-detect credentials file from keys folder if not set
    if not args.credentials:
        keys_dir = Path("keys")
        if keys_dir.exists():
            json_files = list(keys_dir.glob("*.json"))
            if json_files:
                # Use the first JSON file found in keys folder
                args.credentials = str(json_files[0])
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = args.credentials
                print(f"Using credentials from: {args.credentials}")

    # Initialize Google Vision client
    try:
        client = vision.ImageAnnotatorClient()
    except Exception as e:
        print(f"Failed to initialize Google Vision client: {e}")
        print("Make sure you have:")
        print("1. Set GOOGLE_APPLICATION_CREDENTIALS to your service account key file")
        print("2. Or place a .json credentials file in the keys/ folder")
        print("3. Or run: gcloud auth application-default login")
        print("4. Or set GOOGLE_CLOUD_PROJECT environment variable")
        sys.exit(1)

    pdfs = list_local_pdfs()
    if args.only_new:
        pdfs = [p for p in pdfs if not already_processed(p)]
    if not pdfs:
        print("No PDFs to process.")
        return

    print(f"Processing {len(pdfs)} PDFs with Google Vision API...")

    for pdf in pdfs:
        print(f"Processing {pdf.name}...")
        
        # Choose processing method based on file size and bucket availability
        if args.bucket and pdf.stat().st_size > 10 * 1024 * 1024:  # 10MB
            raw_text = process_pdf_with_vision_gcs(pdf, client, args.bucket)
        else:
            raw_text = process_pdf_with_vision(pdf, client)
        
        if raw_text:
            data = make_initial_json(pdf, raw_text)
            out_path = write_json(pdf, data)
            print(f"[OK] Wrote {out_path}")
        else:
            print(f"[ERROR] No text extracted from {pdf.name}")

    # Run local enrichment pipeline
    print("\nRunning enrichment scripts...")
    run_local_enrichment()
    print("Pipeline complete.")


if __name__ == "__main__":
    main()
