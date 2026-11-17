"""EMBEDDING_PROVIDER=model2vec: questions are embedded by the same small local model as the stored chunks."""
import numpy as np
import pytest

from app import config, retrieval, static_embed

pytestmark = pytest.mark.unit


class FakeStatic:
    dim = 3

    def __init__(self):
        self.calls = 0

    def encode(self, texts):
        self.calls += 1
        return np.array([[len(t), 1.0, 0.0] for t in texts], dtype=np.float32)


@pytest.fixture
def m2v(monkeypatch):
    model = FakeStatic()
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "model2vec")
    monkeypatch.setattr(config, "EMBEDDING_ID", "model2vec:test")
    monkeypatch.setattr(static_embed, "_model", model)
    from app.cache import TTLCache
    monkeypatch.setattr(retrieval, "_embeddings", TTLCache(maxsize=10, ttl=60))
    return model


def test_questions_match_the_stored_chunk_format(m2v):
    q = retrieval.embed_query("fees?")
    d = retrieval.embed_documents(["fees?"])[0]
    assert q.shape == (config.EMBEDDING_DIM,) and np.allclose(q, d)
    assert abs(np.linalg.norm(q) - 1) < 1e-5 and not q[3:].any()


def test_repeated_questions_are_not_embedded_again(m2v):
    retrieval.embed_query("Open on Sunday?")
    retrieval.embed_query("Open on Sunday?")
    assert m2v.calls == 1


def test_model_is_loaded_through_the_provider(m2v):
    assert retrieval.get_model() is m2v
