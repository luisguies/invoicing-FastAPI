#!/usr/bin/env python3
"""
FastAPI server for PDF OCR processing.
"""

import os
import traceback
import time
import json
import hmac
import uuid
import hashlib
import threading
from typing import Optional

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ai_helpers import acquire_ai_document_slot
from extract_old_invoice import extract_old_invoice
from pdf_ocr import process_pdf

app = FastAPI(title="PDF OCR Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/app/uploads")
MAX_UPLOAD_BYTES = max(1, int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))))
FASTAPI_API_KEY = os.getenv("FASTAPI_API_KEY", "").strip()
WEBHOOK_SECRET = os.getenv("AI_WEBHOOK_SECRET", "").strip()
WEBHOOK_TOLERANCE_SECONDS = max(1, int(os.getenv("AI_WEBHOOK_TOLERANCE_SECONDS", "300")))

# In-memory webhook event store for idempotency + diagnostics.
_webhook_lock = threading.Lock()
_seen_event_ids = set()
_ai_callbacks = {}
_MAX_WEBHOOK_EVENTS_IN_MEMORY = 10000


def _ai_rate_limit_per_hour() -> int:
    try:
        return max(1, int(os.getenv("AI_DOCUMENTS_PER_HOUR", "100")))
    except ValueError:
        return 100


def _auth_failed_response() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"success": False, "error": "Unauthorized"},
    )


def _validate_api_key(request: Request) -> Optional[JSONResponse]:
    """
    Optional API-key auth:
    - if FASTAPI_API_KEY is set, require X-API-Key header
    - if unset, auth is disabled for local/dev compatibility
    """
    if not FASTAPI_API_KEY:
        return None

    provided = request.headers.get("x-api-key", "")
    if not provided or not hmac.compare_digest(provided, FASTAPI_API_KEY):
        return _auth_failed_response()
    return None


def _safe_filename(name: str) -> str:
    base = os.path.basename((name or "").strip())
    if not base:
        base = "upload.pdf"
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    cleaned = "".join(ch for ch in base if ch in allowed).strip("._")
    return cleaned or "upload.pdf"


async def _save_uploaded_file_with_limits(file: UploadFile) -> str:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = _safe_filename(file.filename or "")
    out_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    total = 0
    chunk_size = 1024 * 1024  # 1MB

    with open(out_path, "wb") as out:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                out.close()
                try:
                    os.remove(out_path)
                except OSError:
                    pass
                raise ValueError(f"File too large. Max allowed size is {MAX_UPLOAD_BYTES} bytes.")
            out.write(chunk)

    return out_path


def _rate_limit_response(retry_after: float) -> JSONResponse:
    """HTTP 429 with Retry-After when too many documents/hour."""
    sec = max(1, int(retry_after) + 1) if retry_after is not None else 60
    body = {
        "success": False,
        "error": (
            f"AI processing rate limit exceeded ({_ai_rate_limit_per_hour()} documents per hour). "
            "Try again later."
        ),
        "code": "rate_limit_exceeded",
        "retry_after_seconds": sec,
    }
    return JSONResponse(
        status_code=429,
        content=body,
        headers={"Retry-After": str(sec)},
    )


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "pdf-ocr"}


@app.post("/extract-old-invoice")
async def extract_old_invoice_endpoint(
    request: Request, file: Optional[UploadFile] = File(default=None)
):
    """
    Extract structured data from an old invoice PDF (Bill To, dates, Driver sections, load lines).
    Accepts: multipart/form-data with 'file', or JSON with 'file_path'.
    Returns: JSON with carrierName, invoiceNumber, invoiceDate, dueDate, groups (driver -> lines), etc.
    """
    try:
        auth_error = _validate_api_key(request)
        if auth_error is not None:
            return auth_error

        if file is not None:
            if not file.filename:
                return JSONResponse(status_code=400, content={"error": "No file provided"})
            ok, retry_after = acquire_ai_document_slot()
            if not ok:
                return _rate_limit_response(retry_after or 60.0)

            try:
                file_path = await _save_uploaded_file_with_limits(file)
            except ValueError as e:
                return JSONResponse(status_code=413, content={"error": str(e)})

            try:
                result = await run_in_threadpool(extract_old_invoice, file_path)
                if result:
                    return {
                        "success": True,
                        "data": result,
                        "filename": file.filename,
                    }
                return JSONResponse(
                    status_code=400,
                    content={
                        "success": False,
                        "error": "Could not extract invoice data from PDF",
                    },
                )
            finally:
                try:
                    os.remove(file_path)
                except OSError:
                    pass
        elif request.headers.get("content-type", "").startswith("application/json"):
            data = await request.json()
            file_path = data.get("file_path")
            if not file_path:
                return JSONResponse(status_code=400, content={"error": "file_path not provided"})
            if not os.path.exists(file_path):
                return JSONResponse(
                    status_code=404,
                    content={"error": f"File not found: {file_path}"},
                )
            ok, retry_after = acquire_ai_document_slot()
            if not ok:
                return _rate_limit_response(retry_after or 60.0)
            result = await run_in_threadpool(extract_old_invoice, file_path)
            if result:
                return {
                    "success": True,
                    "data": result,
                    "filename": os.path.basename(file_path),
                }
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Could not extract invoice data from PDF"},
            )
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "No file or file_path provided"},
            )
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/process-pdf")
async def process_pdf_endpoint(request: Request, file: Optional[UploadFile] = File(default=None)):
    """
    Process a PDF file and extract load data.
    
    Accepts:
    - JSON with 'file_path' field pointing to PDF file
    - OR multipart/form-data with 'file' field containing PDF file
    
    Returns:
    - JSON with extracted load data
    """
    try:
        auth_error = _validate_api_key(request)
        if auth_error is not None:
            return auth_error

        request_id = uuid.uuid4().hex

        # Check if file is uploaded directly
        if file is not None:
            if not file.filename:
                return JSONResponse(status_code=400, content={"error": "No file provided"})

            ok, retry_after = acquire_ai_document_slot()
            if not ok:
                return _rate_limit_response(retry_after or 60.0)

            try:
                file_path = await _save_uploaded_file_with_limits(file)
            except ValueError as e:
                return JSONResponse(status_code=413, content={"error": str(e)})

            try:
                # Process the PDF
                result = await run_in_threadpool(process_pdf, file_path)
                
                if result:
                    return {
                        "success": True,
                        "data": result,
                        "filename": file.filename,
                        "request_id": request_id,
                    }
                else:
                    return JSONResponse(
                        status_code=400,
                        content={
                            "success": False,
                            "error": (
                                "Could not extract data from PDF. The OCR service may have "
                                "failed to parse the document or the document format is "
                                "not supported."
                            ),
                        },
                    )
            except Exception as e:
                error_msg = str(e)
                traceback.print_exc()
                return JSONResponse(
                    status_code=500,
                    content={
                        "success": False,
                        "error": f"Error processing PDF: {error_msg}",
                    },
                )
            finally:
                try:
                    os.remove(file_path)
                except OSError:
                    pass
                
        # Check if file path is provided in JSON
        elif request.headers.get("content-type", "").startswith("application/json"):
            data = await request.json()
            file_path = data.get("file_path")
            
            if not file_path:
                return JSONResponse(status_code=400, content={"error": "file_path not provided"})
            
            if not os.path.exists(file_path):
                return JSONResponse(
                    status_code=404,
                    content={"error": f"File not found: {file_path}"},
                )
            
            ok, retry_after = acquire_ai_document_slot()
            if not ok:
                return _rate_limit_response(retry_after or 60.0)
            # Process the PDF
            result = await run_in_threadpool(process_pdf, file_path)
            
            if result:
                return {
                    "success": True,
                    "data": result,
                    "filename": os.path.basename(file_path),
                    "request_id": request_id,
                }
            else:
                return JSONResponse(
                    status_code=400,
                    content={"success": False, "error": "Could not extract data from PDF"},
                )
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "No file or file_path provided"},
            )
            
    except Exception as e:
        error_msg = str(e)
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": error_msg},
        )


@app.post("/webhooks/ai-callback")
async def ai_callback_webhook(request: Request):
    """
    Receive async callbacks from AI providers/workers.
    Security:
    - HMAC SHA-256 signature over "<timestamp>.<raw_body>" in X-Webhook-Signature
    - X-Webhook-Timestamp replay window check
    - idempotent event processing by event_id
    """
    if not WEBHOOK_SECRET:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error": "Webhook callback endpoint is disabled (AI_WEBHOOK_SECRET not set).",
            },
        )

    ts_raw = request.headers.get("x-webhook-timestamp", "").strip()
    sig = request.headers.get("x-webhook-signature", "").strip()
    if not ts_raw or not sig:
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Missing webhook authentication headers."},
        )

    try:
        ts = int(ts_raw)
    except ValueError:
        return JSONResponse(status_code=401, content={"success": False, "error": "Invalid timestamp."})

    now = int(time.time())
    if abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS:
        return JSONResponse(status_code=401, content={"success": False, "error": "Stale webhook timestamp."})

    raw = await request.body()
    signed_payload = f"{ts_raw}.".encode("utf-8") + raw
    expected = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, sig):
        return JSONResponse(status_code=401, content={"success": False, "error": "Invalid signature."})

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON payload."})

    event_id = str(payload.get("event_id") or "").strip()
    request_id = str(payload.get("request_id") or "").strip()
    status = str(payload.get("status") or "").strip()
    if not event_id or not request_id or not status:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "event_id, request_id, and status are required."},
        )

    duplicate = False
    with _webhook_lock:
        if event_id in _seen_event_ids:
            duplicate = True
        else:
            _seen_event_ids.add(event_id)
            _ai_callbacks[request_id] = {
                "event_id": event_id,
                "request_id": request_id,
                "status": status,
                "provider": payload.get("provider"),
                "result": payload.get("result"),
                "error": payload.get("error"),
                "received_at_epoch": now,
            }
            if len(_seen_event_ids) > _MAX_WEBHOOK_EVENTS_IN_MEMORY:
                # Bound memory footprint under sustained callback load.
                oldest_request_id = next(iter(_ai_callbacks.keys()), None)
                if oldest_request_id is not None:
                    oldest = _ai_callbacks.pop(oldest_request_id, None)
                    if oldest and oldest.get("event_id"):
                        _seen_event_ids.discard(oldest["event_id"])

    return {
        "success": True,
        "duplicate": duplicate,
        "request_id": request_id,
    }


@app.get("/webhooks/ai-callback/{request_id}")
async def get_ai_callback_status(request_id: str, request: Request):
    """
    Internal diagnostics endpoint: check latest callback status by request_id.
    Protected by optional FASTAPI_API_KEY.
    """
    auth_error = _validate_api_key(request)
    if auth_error is not None:
        return auth_error

    with _webhook_lock:
        callback = _ai_callbacks.get(request_id)

    if callback is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Callback not found for request_id."},
        )
    return {"success": True, "callback": callback}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv('PORT', 8000))
    uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=True)

