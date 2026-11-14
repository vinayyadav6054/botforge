"""Unit tests for Gemini embeddings (EMBEDDING_PROVIDER=gemini), with the API replaced by a fake."""
from types import SimpleNamespace

import numpy as np
import pytest

from app import config, embedder, gemini_embed

pytestmark = pytest.mark.unit


class ApiError(Exception):
    def __init__(self, code):
        self.code = code


class FakeModels:
    def __init__(self, errors=(), dim=None):
        self.calls, self.errors, self.dim = [], list(errors), dim

    def embed_content(self, model, contents, config):
        self.calls.append((model, list(contents), config.task_type, config.output_dimensionality))
        if self.errors:
            raise self.errors.pop(0)
        n = self.dim or config.output_dimensionality
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[float(len(t))] * n) for t in contents])


@pytest.fixture
def fake(monkeypatch):
    models = FakeModels()
    monkeypatch.setattr(gemini_embed, "_client", SimpleNamespace(models=models))
    monkeypatch.setattr(gemini_embed, "sleep", lambda s: models.calls.append(("sleep", s)))
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "gemini")
    return models


def test_documents_are_embedded_in_batches_with_the_configured_size(fake):
    texts = [f"chunk {i}" for i in range(250)]
    vectors = embedder.embed(texts)
    assert len(vectors) == 250 and all(v.shape == (config.EMBEDDING_DIM,) and v.dtype == np.float32 for v in vectors)
    assert [len(c[1]) for c in fake.calls] == [100, 100, 50]
    assert {c[2] for c in fake.calls} == {"RETRIEVAL_DOCUMENT"}
    assert {c[3] for c in fake.calls} == {config.EMBEDDING_DIM}
    assert [c[1][0] for c in fake.calls] == ["chunk 0", "chunk 100", "chunk 200"]   # order kept


def test_rate_limits_are_retried(fake):
    fake.errors = [ApiError(429), ApiError(503)]
    assert len(embedder.embed(["a"])) == 1
    assert [c for c in fake.calls if c[0] == "sleep"] == [("sleep", 2.0), ("sleep", 5.0)]


def test_timeouts_and_dropped_connections_are_retried(fake):
    import httpx
    fake.errors = [httpx.ReadTimeout("slow"), httpx.ConnectError("reset")]
    assert len(embedder.embed(["a"])) == 1
    assert [c for c in fake.calls if c[0] == "sleep"] == [("sleep", 2.0), ("sleep", 5.0)]


def test_gives_up_after_the_last_retry(fake):
    fake.errors = [ApiError(429)] * 10
    with pytest.raises(ApiError):
        embedder.embed(["a"])


def test_permanent_errors_are_not_retried(fake):
    fake.errors = [ApiError(400)]
    with pytest.raises(ApiError):
        embedder.embed(["a"])
    assert not [c for c in fake.calls if c[0] == "sleep"]


def test_wrong_dimension_is_rejected(fake):
    fake.dim = 768
    with pytest.raises(RuntimeError, match="unexpected shape"):
        embedder.embed(["a"])


def test_no_local_model_is_loaded_for_gemini(fake):
    assert embedder.get_model() is None
