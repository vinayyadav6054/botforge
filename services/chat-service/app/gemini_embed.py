"""Embeddings from the Gemini API (EMBEDDING_PROVIDER=gemini).

Uses almost no memory compared with the local model, so the services fit on small free hosts.
Kept identical in the ingestion and chat services (each service is deployed on its own).
"""
import logging
import time

import httpx
import numpy as np

from . import config

log = logging.getLogger(__name__)

BATCH_SIZE = 100                       # texts per API request (Gemini's batch limit)
RETRY_DELAYS = (2.0, 5.0, 15.0, 30.0)  # free-tier rate limits clear within a minute
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


def is_transient(ex: Exception) -> bool:
    """Overload, rate limit, a timeout or a dropped connection: worth another try."""
    return getattr(ex, "code", None) in TRANSIENT_STATUS or isinstance(ex, (httpx.TimeoutException, httpx.NetworkError))

_client = None
sleep = time.sleep                     # replaced in tests


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
