"""Document vectors from the chat service on the same machine (EMBED_SERVICE_URL is set).

On a 512 MB free host each process that loads the embedding model needs ~70 MB more, so only the chat
service loads it and this worker asks it for vectors. The chat service says which model made them;
a different one would make vectors that cannot be compared with the stored ones, so that is an error.
"""
import time

import httpx
import numpy as np

from . import config

BATCH_SIZE = 64
# the chat service may still be starting (model loading) or briefly busy: wait and try again
RETRY_DELAYS = (2, 5, 10, 20, 30, 60)
sleep = time.sleep


def embed(texts: list[str]) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for i in range(0, len(texts), BATCH_SIZE):
        out.extend(_embed_batch(texts[i:i + BATCH_SIZE]))
    return out


def _embed_batch(batch: list[str]) -> list[np.ndarray]:
    url = config.EMBED_SERVICE_URL + "/internal/embed"
    headers = {"X-Internal-Key": config.INTERNAL_API_KEY}
    for delay in (*RETRY_DELAYS, None):
        try:
            r = httpx.post(url, json={"texts": batch}, headers=headers, timeout=120)
            if r.status_code < 500:
                r.raise_for_status()   # 4xx (wrong key, bad request): retrying does not help
                break
            problem = f"HTTP {r.status_code}"
        except httpx.TransportError as e:
            problem = str(e) or type(e).__name__
        if delay is None:
            raise RuntimeError(f"The chat service could not make embeddings: {problem}")
        sleep(delay)
    data = r.json()
    if data.get("model") != config.EMBEDDING_ID:
        raise RuntimeError(f"The chat service uses {data.get('model')}, this service expects {config.EMBEDDING_ID}: "
                           "set the same EMBEDDING_PROVIDER/EMBEDDING_MODEL for both")
    vectors = data["vectors"]
    if len(vectors) != len(batch):
        raise RuntimeError(f"The chat service returned {len(vectors)} vectors for {len(batch)} texts")
    return [np.asarray(v, dtype=np.float32) for v in vectors]
