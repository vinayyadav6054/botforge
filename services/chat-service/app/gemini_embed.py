"""Embeddings from the Gemini API (EMBEDDING_PROVIDER=gemini).

Uses almost no memory compared with the local model, so the services fit on small free hosts.
Kept identical in the ingestion and chat services (each service is deployed on its own).
"""
import logging
import os
import threading
import time
from collections import deque

import httpx
import numpy as np

from . import config

log = logging.getLogger(__name__)

# The free tier counts every text as one request: 100 per minute for the whole API key, shared by
# the ingestion and chat services. Big websites are paced to stay under it instead of failing.
TEXTS_PER_MINUTE = max(1, int(os.getenv("GEMINI_EMBED_TEXTS_PER_MINUTE", "80")))
BATCH_SIZE = min(50, TEXTS_PER_MINUTE)       # texts per API request (Gemini allows up to 100)
RETRY_DELAYS = (2.0, 5.0, 15.0, 30.0, 60.0, 60.0)  # a per-minute limit clears within a minute
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def is_transient(ex: Exception) -> bool:
    """Overload, rate limit, a timeout or a dropped connection: worth another try."""
    return getattr(ex, "code", None) in TRANSIENT_STATUS or isinstance(ex, (httpx.TimeoutException, httpx.NetworkError))

_client = None
sleep = time.sleep                     # replaced in tests
clock = time.monotonic                 # replaced in tests
_sent: deque = deque()                 # (time, number of texts) sent in the last minute
_lock = threading.Lock()


def _wait_for_quota(n: int) -> None:
    """Blocks until sending n more texts keeps this process under TEXTS_PER_MINUTE."""
    with _lock:
        while True:
            now = clock()
            while _sent and now - _sent[0][0] >= 60:
                _sent.popleft()
            used = sum(c for _, c in _sent)
            if not _sent or used + n <= TEXTS_PER_MINUTE:
                _sent.append((now, n))
                return
            wait = 60 - (now - _sent[0][0]) + 0.5
            log.info("Pacing Gemini embeddings: waiting %.0fs for the per-minute quota", wait)
            sleep(wait)


def _get_client():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types
        _client = genai.Client(api_key=config.GEMINI_API_KEY, http_options=types.HttpOptions(timeout=60_000, api_version="v1beta"))
    return _client


def _embed_batch(texts: list[str], task_type: str) -> list[np.ndarray]:
    from google.genai import types

    for attempt in range(len(RETRY_DELAYS) + 1):
        _wait_for_quota(len(texts))
        try:
            result = _get_client().models.embed_content(
                model=config.GEMINI_EMBEDDING_MODEL,
                contents=texts,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=config.EMBEDDING_DIM),
            )
            vectors = [np.asarray(e.values, dtype=np.float32) for e in result.embeddings]
            if len(vectors) != len(texts) or any(v.shape != (config.EMBEDDING_DIM,) for v in vectors):
                raise RuntimeError("Gemini returned embeddings of an unexpected shape")
            return vectors
        except Exception as ex:
            if not is_transient(ex) or attempt == len(RETRY_DELAYS):
                raise
            log.warning("Gemini embeddings failed (%s), retrying in %.0fs",
                        getattr(ex, "code", None) or type(ex).__name__, RETRY_DELAYS[attempt])
            sleep(RETRY_DELAYS[attempt])
    raise AssertionError("unreachable")


def embed(texts: list[str], task_type: str) -> list[np.ndarray]:
    """task_type: RETRIEVAL_DOCUMENT for stored chunks, RETRIEVAL_QUERY for questions."""
    vectors: list[np.ndarray] = []
    for i in range(0, len(texts), BATCH_SIZE):
        vectors.extend(_embed_batch(texts[i:i + BATCH_SIZE], task_type))
    return vectors
