"""Unit tests for Gemini query embeddings (EMBEDDING_PROVIDER=gemini), with the API replaced by a fake."""
from types import SimpleNamespace

import pytest

from app import config, gemini_embed, retrieval

pytestmark = pytest.mark.unit


class FakeModels:
    def __init__(self):
        self.calls = []

    def embed_content(self, model, contents, config):
        self.calls.append((model, list(contents), config.task_type, config.output_dimensionality))
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.5] * config.output_dimensionality)
                                           for _ in contents])


@pytest.fixture
def fake(monkeypatch):
    models = FakeModels()
    monkeypatch.setattr(gemini_embed, "_client", SimpleNamespace(models=models))
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "gemini")
    return models


def test_questions_use_the_query_task_type(fake):
    vector = retrieval.embed_query("Open on Sunday?")
    assert vector.shape == (config.EMBEDDING_DIM,)
    assert fake.calls == [(config.GEMINI_EMBEDDING_MODEL, ["Open on Sunday?"], "RETRIEVAL_QUERY", config.EMBEDDING_DIM)]


def test_documents_use_the_document_task_type(fake):
    retrieval.embed_documents(["a", "b"])
    assert fake.calls[0][2] == "RETRIEVAL_DOCUMENT"


def test_no_local_model_is_loaded_for_gemini(fake):
    assert retrieval.get_model() is None
