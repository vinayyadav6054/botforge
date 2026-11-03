"""Integration tests: real pgvector retrieval with real embeddings, and the real bot-service client over HTTP."""
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg
import pytest
from pgvector.psycopg import register_vector

from app import bots_client, config, retrieval

pytestmark = pytest.mark.integration


@pytest.fixture
def db(test_database_url, monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", test_database_url)
    with psycopg.connect(test_database_url, autocommit=True) as conn:
        register_vector(conn)
        conn.execute("TRUNCATE knowledge.chunks")
        yield conn


def insert(conn, tenant, bot, texts):
    vectors = list(retrieval.get_model().embed(texts))
    doc = uuid.uuid4()
    with conn.cursor() as cur:
        for i, (t, v) in enumerate(zip(texts, vectors)):
            cur.execute("INSERT INTO knowledge.chunks (tenant_id, bot_id, document_id, chunk_index, content, embedding)"
                        " VALUES (%s, %s, %s, %s, %s, %s)", (tenant, bot, doc, i, t, v))


FAQ = [
    "We are open Monday to Saturday from 7am to 6pm and closed on Sundays.",
    "A sourdough loaf costs 6 dollars and a croissant costs 3 dollars.",
    "Delivery is free for orders over 30 dollars within the city.",
    "We can bake custom birthday cakes with two days notice.",
]


def test_returns_most_relevant_chunks_first(db):
    tenant, bot = uuid.uuid4(), uuid.uuid4()
    insert(db, tenant, bot, FAQ)

    results = retrieval.retrieve(tenant, bot, "How much is the bread?", top_k=2)
    assert len(results) == 2
    assert "sourdough" in results[0][0]
    assert results[0][1] >= results[1][1]
    assert all(-1.0 <= score <= 1.0 for _, score in results)

    assert "Sundays" in retrieval.retrieve(tenant, bot, "Are you open on Sunday?", top_k=1)[0][0]


def test_never_returns_another_tenants_or_bots_knowledge(db):
    tenant_a, bot_a = uuid.uuid4(), uuid.uuid4()
    tenant_b, bot_b = uuid.uuid4(), uuid.uuid4()
    insert(db, tenant_a, bot_a, ["Tenant A secret: the wifi password is hunter2."])
    insert(db, tenant_b, bot_b, ["Tenant B sells bicycles."])
    other_bot_same_tenant = uuid.uuid4()
    insert(db, tenant_a, other_bot_same_tenant, ["Internal HR policy of tenant A."])

    results = retrieval.retrieve(tenant_b, bot_b, "What is the wifi password?", top_k=10)
    assert [r[0] for r in results] == ["Tenant B sells bicycles."]
    # right bot, wrong tenant -> nothing
    assert retrieval.retrieve(tenant_b, bot_a, "wifi password", top_k=10) == []
    # same tenant, other bot -> only that bot's chunk
    assert [r[0] for r in retrieval.retrieve(tenant_a, bot_a, "policy", top_k=10)] == [
        "Tenant A secret: the wifi password is hunter2."]


def test_bot_without_documents_returns_nothing(db):
    assert retrieval.retrieve(uuid.uuid4(), uuid.uuid4(), "anything", top_k=5) == []


class _FakeBotService(BaseHTTPRequestHandler):
    seen_keys: list = []

    def do_GET(self):
        _FakeBotService.seen_keys.append(self.headers.get("X-Internal-Key"))
        if self.path == "/internal/bots/bk_known":
            body = b'{"botId":"b","tenantId":"t","name":"N","welcomeMessage":"W"}'
            self.send_response(200)
        elif self.path == "/internal/bots/bk_boom":
            body = b"{}"
            self.send_response(500)
        else:
            body = b""
            self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def bot_service(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _FakeBotService)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(config, "BOTS_SERVICE_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(config, "INTERNAL_API_KEY", "shared-secret")
    _FakeBotService.seen_keys = []
    yield
    server.shutdown()


async def test_bot_client_sends_internal_key_and_maps_responses(bot_service):
    import httpx

    assert (await bots_client.resolve_bot("bk_known"))["name"] == "N"
    assert await bots_client.resolve_bot("bk_unknown") is None
    with pytest.raises(httpx.HTTPStatusError):
        await bots_client.resolve_bot("bk_boom")
    assert set(_FakeBotService.seen_keys) == {"shared-secret"}
