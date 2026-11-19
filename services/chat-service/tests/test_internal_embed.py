"""POST /internal/embed: the ingestion worker on the same machine gets vectors from this process's model."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, main

pytestmark = pytest.mark.unit


@pytest.fixture
def client(monkeypatch):
    calls = []

    def embed_documents(texts):
        calls.append(list(texts))
        return [np.array([len(t), 0.5], dtype=np.float32) for t in texts]

    monkeypatch.setattr(main, "get_model", lambda: None)
    monkeypatch.setattr(main, "embed_documents", embed_documents)
    with TestClient(main.app) as c:
        c.calls = calls
        yield c


def test_returns_one_vector_per_text_and_names_the_model(client):
    r = client.post("/internal/embed", json={"texts": ["abc", "hello"]},
                    headers={"X-Internal-Key": config.INTERNAL_API_KEY})
    assert r.status_code == 200
    assert r.json() == {"model": config.EMBEDDING_ID, "vectors": [[3.0, 0.5], [5.0, 0.5]]}
    assert client.calls == [["abc", "hello"]]


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Key": "wrong"}])
def test_needs_the_internal_key(client, headers):
    r = client.post("/internal/embed", json={"texts": ["abc"]}, headers=headers)
    assert r.status_code == 401
    assert client.calls == []


def test_rejects_empty_and_oversized_batches(client):
    h = {"X-Internal-Key": config.INTERNAL_API_KEY}
    assert client.post("/internal/embed", json={"texts": []}, headers=h).status_code == 422
    assert client.post("/internal/embed", json={"texts": ["x"] * 257}, headers=h).status_code == 422
    assert client.calls == []
