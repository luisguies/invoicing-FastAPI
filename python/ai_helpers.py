#!/usr/bin/env python3
"""
Shared helpers for AI/OCR: per-document rate limiting (sliding window), retries, and
classifying transient API errors (OpenAI + Gemini).
"""

from __future__ import annotations

import os
import random
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, List, Optional, Tuple, TypeVar

T = TypeVar("T")

# --- Rate limiting: documents per hour (each /process-pdf or /extract-old-invoice counts as one) ---

DEFAULT_DOCUMENTS_PER_HOUR = 100
DEFAULT_WINDOW_SECONDS = 3600.0


class SlidingWindowRateLimiter:
    """Thread-safe sliding window limiter (monotonic clock)."""

    def __init__(self, max_calls: int, window_seconds: float):
        self.max_calls = max(1, int(max_calls))
        self.window_seconds = float(window_seconds)
        self._times: Deque[float] = deque()
        self._lock = threading.Lock()

    def try_acquire(self) -> Tuple[bool, Optional[float]]:
        """
        If under the limit, record one slot and return (True, None).
        Otherwise return (False, retry_after_seconds).
        """
        now = time.monotonic()
        with self._lock:
            cutoff = now - self.window_seconds
            while self._times and self._times[0] <= cutoff:
                self._times.popleft()
            if len(self._times) >= self.max_calls:
                oldest = self._times[0]
                retry_after = self.window_seconds - (now - oldest)
                return False, max(0.0, retry_after)
            self._times.append(now)
            return True, None

    def reset_for_tests(self) -> None:
        with self._lock:
            self._times.clear()


def _documents_per_hour() -> int:
    raw = os.getenv("AI_DOCUMENTS_PER_HOUR", str(DEFAULT_DOCUMENTS_PER_HOUR))
    try:
        n = int(raw)
        return max(1, n)
    except ValueError:
        return DEFAULT_DOCUMENTS_PER_HOUR


_document_limiter = SlidingWindowRateLimiter(
    _documents_per_hour(),
    float(os.getenv("AI_RATE_LIMIT_WINDOW_SECONDS", str(DEFAULT_WINDOW_SECONDS))),
)


def acquire_ai_document_slot() -> Tuple[bool, Optional[float]]:
    """Call at the start of each document-processing HTTP request."""
    return _document_limiter.try_acquire()


# --- OpenAI retries ---

def _openai_retryable(exc: BaseException) -> bool:
    try:
        from openai import APIConnectionError, APITimeoutError, RateLimitError

        if isinstance(exc, (APITimeoutError, APIConnectionError, RateLimitError)):
            return True
    except ImportError:
        pass

    try:
        from openai import APIError

        if isinstance(exc, APIError):
            code = getattr(exc, "status_code", None)
            if code is None and hasattr(exc, "response") and exc.response is not None:
                code = getattr(exc.response, "status_code", None)
            if code in (408, 409, 429, 500, 502, 503, 504):
                return True
    except ImportError:
        pass

    msg = str(exc).lower()
    if "timeout" in msg or "timed out" in msg or "connection" in msg:
        return True
    if "rate limit" in msg or "429" in msg:
        return True
    return False


def openai_responses_create_with_retry(client: Any, **kwargs: Any) -> Any:
    """
    Call client.responses.create with exponential backoff on transient failures.
    Env: AI_OPENAI_MAX_ATTEMPTS (default 4), AI_OPENAI_RETRY_BASE_DELAY (default 1.0),
         AI_OPENAI_RETRY_MAX_DELAY (default 60.0)
    """
    max_attempts = int(os.getenv("AI_OPENAI_MAX_ATTEMPTS", "4"))
    max_attempts = max(1, max_attempts)
    base = float(os.getenv("AI_OPENAI_RETRY_BASE_DELAY", "1.0"))
    cap = float(os.getenv("AI_OPENAI_RETRY_MAX_DELAY", "60.0"))

    last_exc: Optional[BaseException] = None
    for attempt in range(max_attempts):
        try:
            return client.responses.create(**kwargs)
        except BaseException as e:
            last_exc = e
            if attempt >= max_attempts - 1 or not _openai_retryable(e):
                raise
            delay = min(cap, base * (2**attempt) + random.uniform(0, 0.25 * base))
            print(
                f"[ai_helpers] OpenAI responses.create retry {attempt + 1}/{max_attempts - 1} "
                f"after error: {e!r}; sleeping {delay:.2f}s"
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


# --- Gemini retries ---

def _gemini_retryable(exc: BaseException) -> bool:
    mod = type(exc).__module__ or ""
    name = type(exc).__name__
    if mod.startswith("google.api_core") and name in (
        "ResourceExhausted",
        "DeadlineExceeded",
        "ServiceUnavailable",
        "InternalServerError",
        "Aborted",
    ):
        return True
    if name in ("ResourceExhausted", "DeadlineExceeded", "ServiceUnavailable", "InternalServerError"):
        return True
    msg = str(exc).lower()
    if "429" in msg or "503" in msg or "504" in msg or "timeout" in msg or "timed out" in msg:
        return True
    if "resource exhausted" in msg or "unavailable" in msg:
        return True
    return False


def gemini_generate_content_with_retry(model: Any, prompt: str, **gen_kwargs: Any) -> Any:
    """
    model.generate_content(prompt, **gen_kwargs) with retries.
    Env: AI_GEMINI_MAX_ATTEMPTS (default 4), AI_GEMINI_RETRY_BASE_DELAY (default 1.0),
         AI_GEMINI_RETRY_MAX_DELAY (default 60.0)
    """
    max_attempts = int(os.getenv("AI_GEMINI_MAX_ATTEMPTS", "4"))
    max_attempts = max(1, max_attempts)
    base = float(os.getenv("AI_GEMINI_RETRY_BASE_DELAY", "1.0"))
    cap = float(os.getenv("AI_GEMINI_RETRY_MAX_DELAY", "60.0"))

    last_exc: Optional[BaseException] = None
    for attempt in range(max_attempts):
        try:
            return model.generate_content(prompt, **gen_kwargs)
        except BaseException as e:
            last_exc = e
            if attempt >= max_attempts - 1 or not _gemini_retryable(e):
                raise
            delay = min(cap, base * (2**attempt) + random.uniform(0, 0.25 * base))
            print(
                f"[ai_helpers] Gemini generate_content retry {attempt + 1}/{max_attempts - 1} "
                f"after error: {e!r}; sleeping {delay:.2f}s"
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc
