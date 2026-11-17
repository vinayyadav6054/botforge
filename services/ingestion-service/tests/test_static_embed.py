"""EMBEDDING_PROVIDER=model2vec: the small local model used on the free host, and re-embedding after a model change."""
import uuid

import numpy as np
import pytest

from app import config, db, embedder, static_embed


class FakeStatic:
    dim = 3

    def encode(self, texts):
        return np.array([[len(t), 1.0, 0.0] for t in texts], dtype=np.float32)


@pytest.fixture
def m2v(monkeypatch):
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "model2vec")
    monkeypatch.setattr(static_embed, "_model", FakeStatic())
    monkeypatch.setattr(config, "EMBEDDING_ID", "model2vec:test")


@pytest.mark.unit
def test_vectors_are_unit_length_and_padded_to_the_column_size(m2v):
    vectors = embedder.embed(["abcd", "ab"])
    assert len(vectors) == 2
    for v in vectors:
        assert v.shape == (config.EMBEDDING_DIM,) and v.dtype == np.float32
        assert abs(np.linalg.norm(v) - 1) < 1e-5
        assert not v[3:].any()                       # padding is zeros
    # zero padding keeps cosine similarity identical to the model's own vectors
    a, b = FakeStatic().encode(["abcd", "ab"])
    assert abs(vectors[0] @ vectors[1] - (a @ b) / np.linalg.norm(a) / np.linalg.norm(b)) < 1e-5


@pytest.mark.unit
def test_nothing_to_embed(m2v):
    assert embedder.embed([]) == []


@pytest.mark.unit
def test_a_model_wider_than_the_column_is_refused(monkeypatch):
    class Wide:
        dim = 1024

    import model2vec
    monkeypatch.setattr(model2vec.StaticModel, "from_pretrained", staticmethod(lambda name: Wide()))
    monkeypatch.setattr(static_embed, "_model", None)
    with pytest.raises(RuntimeError, match="EMBEDDING_DIM"):
        static_embed.get_model()


@pytest.mark.unit
def test_default_model_for_the_provider():
    import importlib
    import os
    old = {k: os.environ.get(k) for k in ("EMBEDDING_PROVIDER", "EMBEDDING_MODEL")}
    try:
        os.environ["EMBEDDING_PROVIDER"] = "model2vec"
        os.environ.pop("EMBEDDING_MODEL", None)
        fresh = importlib.reload(config)
        assert fresh.EMBEDDING_MODEL == "minishlab/potion-base-8M"
        assert fresh.EMBEDDING_ID == "model2vec:minishlab/potion-base-8M"
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(config)


@pytest.mark.unit
def test_the_real_model_finds_the_fee_chunk():
    """The packaged model itself (downloaded once into the Hugging Face cache)."""
    pytest.importorskip("model2vec")
    from model2vec import StaticModel
    try:
        model = StaticModel.from_pretrained("minishlab/potion-base-8M")
    except Exception as ex:   # offline machine
        pytest.skip(f"model not available: {ex}")
    docs = ["Fees for the two-year JEE programme are Rs 1,20,000 including study material.",
            "Our Borivali West centre is near the railway station, 2nd floor.",
            "Weekly tests are held every Sunday morning."]
    d = model.encode(docs)
    q = model.encode(["How much does the JEE course cost?"])[0]
    scores = d @ q / np.linalg.norm(d, axis=1) / np.linalg.norm(q)
    assert int(np.argmax(scores)) == 0


@pytest.mark.integration
def test_chunks_stored_by_another_model_are_reembedded_from_their_text(db_conn, ids, m2v, monkeypatch):
    with db_conn.cursor() as cur:   # re-embedding covers the whole table: start from an empty one
        cur.execute("DELETE FROM knowledge.chunks")
    db_conn.commit()
    old = [np.ones(config.EMBEDDING_DIM, dtype=np.float32)] * 2
    monkeypatch.setattr(config, "EMBEDDING_ID", "gemini:old")
    db.replace_chunks(db_conn, ids["tenant"], ids["bot"], ids["doc"], ["abcd", "ab"], old)
    with db_conn.cursor() as cur:   # a chunk from before the model was tracked
        cur.execute("UPDATE knowledge.chunks SET embedding_model = NULL WHERE chunk_index = 1")
    db_conn.commit()

    monkeypatch.setattr(config, "EMBEDDING_ID", "model2vec:test")
    assert db.reembed_stale(db_conn, embedder.embed, batch=1) == 2
    assert db.reembed_stale(db_conn, embedder.embed) == 0          # nothing left: start-up stays quick
    # no transaction left open while the worker waits for messages
    import psycopg
    assert db_conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE

    with db_conn.cursor() as cur:
        cur.execute("SELECT content, embedding, embedding_model FROM knowledge.chunks WHERE document_id = %s "
                    "ORDER BY chunk_index", (ids["doc"],))
        rows = cur.fetchall()
    assert [r[2] for r in rows] == ["model2vec:test"] * 2
    for content, vector, _ in rows:
        assert np.allclose(vector.to_numpy(), embedder.embed([content])[0], atol=1e-5)


@pytest.mark.integration
def test_new_chunks_record_their_model(db_conn, ids, m2v):
    db.replace_chunks(db_conn, ids["tenant"], ids["bot"], uuid.uuid4(), ["x"], embedder.embed(["x"]))
    with db_conn.cursor() as cur:
        cur.execute("SELECT DISTINCT embedding_model FROM knowledge.chunks WHERE bot_id = %s", (ids["bot"],))
        assert cur.fetchall() == [("model2vec:test",)]
