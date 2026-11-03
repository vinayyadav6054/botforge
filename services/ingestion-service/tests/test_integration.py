"""Integration tests: real Postgres + pgvector (docker) and the real embedding model."""
import json
import uuid

import pytest

from app import db, worker
from app.embedder import embed

pytestmark = pytest.mark.integration


def _count(conn, **where):
    sql = "SELECT count(*) FROM knowledge.chunks WHERE " + " AND ".join(f"{k} = %s" for k in where)
    with conn.cursor() as cur:
        cur.execute(sql, tuple(where.values()))
        return cur.fetchone()[0]


def _write_doc(storage, ids, text, ext=".txt"):
    key = f"{ids['tenant']}/{ids['bot']}/{ids['doc']}{ext}"
    path = storage / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return key


def _msg(ids, key):
    return json.dumps({"documentId": str(ids["doc"]), "tenantId": str(ids["tenant"]),
                       "botId": str(ids["bot"]), "storageKey": key, "fileName": "faq.txt"}).encode()


def test_schema_is_idempotent(db_conn):
    db.ensure_schema(db_conn)
    db.ensure_schema(db_conn)


def test_uploaded_document_is_chunked_embedded_and_stored(db_conn, storage, ids):
    text = "\n\n".join(f"Paragraph {i}: our bakery sells sourdough, rye and croissants every morning." * 3
                       for i in range(12))
    key = _write_doc(storage, ids, text)
    published = []

    worker.Handler(db_conn, lambda k, p: published.append((k, p))).handle("document.uploaded", _msg(ids, key))

    assert published[0][0] == "document.processed"
    count = published[0][1]["chunkCount"]
    assert count > 1
    assert _count(db_conn, document_id=ids["doc"], tenant_id=ids["tenant"], bot_id=ids["bot"]) == count
    with db_conn.cursor() as cur:
        cur.execute("SELECT chunk_index, vector_dims(embedding) FROM knowledge.chunks WHERE document_id = %s "
                    "ORDER BY chunk_index", (ids["doc"],))
        rows = cur.fetchall()
    assert [r[0] for r in rows] == list(range(count))
    assert {r[1] for r in rows} == {384}


def test_reprocessing_replaces_chunks_instead_of_duplicating(db_conn, storage, ids):
    key = _write_doc(storage, ids, "Version one of the FAQ.")
    h = worker.Handler(db_conn, lambda k, p: None)
    h.handle("document.uploaded", _msg(ids, key))
    (storage / key).write_text("Version two. " * 200, encoding="utf-8")
    h.handle("document.uploaded", _msg(ids, key))

    with db_conn.cursor() as cur:
        cur.execute("SELECT content FROM knowledge.chunks WHERE document_id = %s", (ids["doc"],))
        contents = [r[0] for r in cur.fetchall()]
    assert contents and all("Version one" not in c for c in contents)


def test_semantic_search_finds_the_relevant_chunk(db_conn, storage, ids):
    text = ("Our opening hours are Monday to Saturday, 7am to 6pm. We are closed on Sundays.\n\n"
            + "Filler about the history of bread making in Europe. " * 40
            + "\n\nDelivery is free for orders above 30 dollars.")
    key = _write_doc(storage, ids, text)
    worker.Handler(db_conn, lambda k, p: None).handle("document.uploaded", _msg(ids, key))

    vector = embed(["Are you open on Sunday?"])[0]
    with db_conn.cursor() as cur:
        cur.execute("SELECT content FROM knowledge.chunks WHERE bot_id = %s ORDER BY embedding <=> %s LIMIT 1",
                    (ids["bot"], vector))
        best = cur.fetchone()[0]
    assert "Sundays" in best


def test_empty_document_fails_without_storing_anything(db_conn, storage, ids):
    key = _write_doc(storage, ids, "   \n\n  ")
    published = []
    worker.Handler(db_conn, lambda k, p: published.append((k, p))).handle("document.uploaded", _msg(ids, key))
    assert published[0][0] == "document.failed"
    assert _count(db_conn, document_id=ids["doc"]) == 0


def test_document_deleted_removes_only_that_document(db_conn, storage, ids):
    h = worker.Handler(db_conn, lambda k, p: None)
    key = _write_doc(storage, ids, "First document.")
    h.handle("document.uploaded", _msg(ids, key))
    other = {**ids, "doc": uuid.uuid4()}
    h.handle("document.uploaded", _msg(other, _write_doc(storage, other, "Second document.")))

    h.handle("document.deleted", json.dumps({"documentId": str(ids["doc"]), "tenantId": str(ids["tenant"]),
                                             "botId": str(ids["bot"])}).encode())
    assert _count(db_conn, document_id=ids["doc"]) == 0
    assert _count(db_conn, document_id=other["doc"]) == 1


def test_delete_with_wrong_tenant_removes_nothing(db_conn, storage, ids):
    h = worker.Handler(db_conn, lambda k, p: None)
    h.handle("document.uploaded", _msg(ids, _write_doc(storage, ids, "Tenant A data.")))
    h.handle("document.deleted", json.dumps({"documentId": str(ids["doc"]), "tenantId": str(uuid.uuid4()),
                                             "botId": str(ids["bot"])}).encode())
    h.handle("bot.deleted", json.dumps({"botId": str(ids["bot"]), "tenantId": str(uuid.uuid4())}).encode())
    assert _count(db_conn, document_id=ids["doc"]) == 1


def test_bot_deleted_removes_all_its_chunks(db_conn, storage, ids):
    h = worker.Handler(db_conn, lambda k, p: None)
    for _ in range(3):
        doc = {**ids, "doc": uuid.uuid4()}
        h.handle("document.uploaded", _msg(doc, _write_doc(storage, doc, "Some bot knowledge.")))
    assert _count(db_conn, bot_id=ids["bot"]) == 3

    h.handle("bot.deleted", json.dumps({"botId": str(ids["bot"]), "tenantId": str(ids["tenant"])}).encode())
    assert _count(db_conn, bot_id=ids["bot"]) == 0


def test_handler_recovers_after_a_database_error(db_conn, storage, ids):
    h = worker.Handler(db_conn, lambda k, p: None)
    with db_conn.cursor() as cur:
        with pytest.raises(Exception):
            cur.execute("SELECT * FROM table_that_does_not_exist")
    # the connection is now in a failed transaction; the handler must roll back and continue
    h._recover_db()
    published = []
    h.publish = lambda k, p: published.append(k)
    h.handle("document.uploaded", _msg(ids, _write_doc(storage, ids, "Still works.")))
    assert published == ["document.processed"]
