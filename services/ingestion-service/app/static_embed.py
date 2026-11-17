"""Embeddings from a small static model on this machine (EMBEDDING_PROVIDER=model2vec).

model2vec "potion" models need only numpy: about 60 MB of RAM, no torch or onnxruntime, no API key and
no daily limit, so they fit next to the other services on a 512 MB free host. On real coaching websites
the right text was in the top 5 as often as with bge-small (which needs ~330 MB).
Kept identical in the ingestion and chat services (each service is deployed on its own).
"""
import threading

import numpy as np

from . import config

_model = None
_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from model2vec import StaticModel   # imported lazily: not needed by the other providers
                model = StaticModel.from_pretrained(config.EMBEDDING_MODEL)
                if model.dim > config.EMBEDDING_DIM:
                    raise RuntimeError(f"{config.EMBEDDING_MODEL} makes {model.dim}-number vectors; "
                                       f"EMBEDDING_DIM is {config.EMBEDDING_DIM}")
                _model = model
    return _model


def embed(texts: list[str]) -> list[np.ndarray]:
    """Unit-length vectors, padded with zeros to EMBEDDING_DIM so the database column stays the same size.
    Zero padding does not change cosine similarity."""
    if not texts:
        return []
    vectors = np.asarray(get_model().encode(list(texts)), dtype=np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12
    padded = np.zeros((len(texts), config.EMBEDDING_DIM), dtype=np.float32)
    padded[:, :vectors.shape[1]] = vectors
    return list(padded)
