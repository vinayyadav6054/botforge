"""EMBED_SERVICE_URL set: vectors come from the chat service, so this process never loads the model."""
import httpx
import numpy as np
import pytest

from app import config, embedder, remote_embed, static_embed

pytestmark = pytest.mark.unit


@pytest.fixture
def remote(monkeypatch):
    """Points the worker at a fake chat service; state["replies"] can queue failures before the answer."""
    state = {"posts": [], "replies": [], "slept": [], "model": "model2vec:test"}
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "model2vec")
    monkeypatch.setattr(config, "EMBEDDING_ID", "model2vec:test")
    monkeypatch.setattr(config, "EMBED_SERVICE_URL", "http://127.0.0.1:8000")
    monkeypatch.setattr(config, "INTERNAL_API_KEY", "k")
    monkeypatch.setattr(remote_embed, "sleep", lambda s: state["slept"].append(s))

    def post(url, json, headers, timeout):
        state["posts"].append((url, list(json["texts"]), headers))
        if state["replies"]:
            reply = state["replies"].pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply
        return httpx.Response(200, json={"model": state["model"], "vectors": [[float(len(t)), 1.0] for t in json["texts"]]},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(remote_embed.httpx, "post", post)
    return state


def test_model_is_not_loaded_and_texts_go_to_the_chat_service_in_batches(remote, monkeypatch):
    def boom():
        raise AssertionError("the model must not be loaded in this process")

    monkeypatch.setattr(static_embed, "get_model", boom)
    assert embedder.get_model() is None
    texts = [f"text {i}" for i in range(remote_embed.BATCH_SIZE + 3)]
    vectors = embedder.embed(texts)
    assert len(vectors) == len(texts)
    assert vectors[0].dtype == np.float32 and list(vectors[0]) == [6.0, 1.0]
    assert [len(p[1]) for p in remote["posts"]] == [remote_embed.BATCH_SIZE, 3]
    url, _, headers = remote["posts"][0]
    assert url == "http://127.0.0.1:8000/internal/embed" and headers == {"X-Internal-Key": "k"}


def test_waits_while_the_chat_service_starts_or_is_busy(remote):
    req = httpx.Request("POST", "http://x")
    remote["replies"] = [httpx.ConnectError("refused"), httpx.Response(503, request=req)]
    assert len(embedder.embed(["a"])) == 1
    assert remote["slept"] == list(remote_embed.RETRY_DELAYS[:2])


def test_gives_up_after_the_last_retry(remote):
    remote["replies"] = [httpx.ConnectError("refused")] * (len(remote_embed.RETRY_DELAYS) + 1)
    with pytest.raises(RuntimeError, match="could not make embeddings"):
        embedder.embed(["a"])


def test_a_wrong_key_fails_at_once(remote):
    remote["replies"] = [httpx.Response(401, request=httpx.Request("POST", "http://x"))]
    with pytest.raises(httpx.HTTPStatusError):
        embedder.embed(["a"])
    assert remote["slept"] == []


def test_vectors_from_another_model_are_refused(remote):
    remote["model"] = "model2vec:other"
    with pytest.raises(RuntimeError, match="model2vec:other"):
        embedder.embed(["a"])
