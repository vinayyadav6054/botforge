"""Level 3: complete user journeys through the gateway, with every real service in the loop
(identity -> bots -> RabbitMQ -> ingestion + embeddings -> pgvector -> chat -> Gemini)."""
import io
import time

import httpx
import pytest
from docx import Document

from conftest import API, GATEWAY, chat

FAQ = (
    "Sunrise Bakery FAQ\n\n"
    "Opening hours: Monday to Saturday from 7am to 6pm. We are closed on Sundays.\n\n"
    "Our members discount code is ORCHID-42 and gives 10 percent off every order.\n\n"
    "A sourdough loaf costs 6 dollars. Delivery is free for orders above 30 dollars.\n"
).encode()


def docx_bytes(*paragraphs: str) -> bytes:
    d = Document()
    for p in paragraphs:
        d.add_paragraph(p)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def test_full_journey_signup_to_grounded_answers_to_cleanup(http, tenant_factory):
    owner = tenant_factory("Sunrise Bakery")

    # login with the same credentials and inspect the session
    login = http.post("/auth/login", json={"email": owner.email.upper(), "password": owner.password})
    assert login.status_code == 200
    me = owner.get("/auth/me").json()
    assert me["email"] == owner.email and me["tenantId"] == owner.tenant_id and me["userId"]

    # create a bot, upload knowledge in two formats, wait for ingestion
    bot = owner.create_bot("Bakery Bot", "Welcome to Sunrise Bakery!")
    txt = owner.upload(bot["id"], "faq.txt", FAQ)
    docx = owner.upload(bot["id"], "cakes.docx", docx_bytes(
        "Custom cakes", "We bake custom birthday cakes. Please order them at least two days in advance."),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    for doc in (txt, docx):
        done = owner.wait_for_document(bot["id"], doc["id"])
        assert done["status"] == "Ready", done
        assert done["chunkCount"] >= 1

    # public widget endpoints (no token)
    info = http.get(f"/chat/{bot['publicKey']}/info").json()
    assert info == {"name": "Bakery Bot", "welcomeMessage": "Welcome to Sunrise Bakery!"}

    answer = chat(http, bot["publicKey"], "What is the members discount code?")
    assert answer["done"] and not answer["error"]
    assert answer["meta"]["botName"] == "Bakery Bot" and answer["meta"]["sources"] >= 1
    assert "ORCHID-42" in answer["text"]

    cakes = chat(http, bot["publicKey"], "How far in advance do I need to order a birthday cake?")
    assert "two" in cakes["text"].lower() or "2" in cakes["text"]

    # follow-up question that only makes sense with the conversation history
    history = [{"role": "user", "text": "Which days are you closed?"},
               {"role": "assistant", "text": "We are closed on Sundays."}]
    follow_up = chat(http, bot["publicKey"], "And what time do you open on the other days?", history)
    assert "7" in follow_up["text"]

    # the bot must not invent facts it was not given
    unknown = chat(http, bot["publicKey"], "What is the name of the head baker's dog?")
    assert unknown["done"]
    assert "ORCHID" not in unknown["text"]

    # deleting the document removes its knowledge (ingestion deletes the chunks asynchronously)
    assert owner.delete(f"/bots/{bot['id']}/documents/{txt['id']}").status_code == 204
    deadline, text = time.time() + 30, ""
    while time.time() < deadline:
        text = chat(http, bot["publicKey"], "What is the members discount code?")["text"]
        if "ORCHID-42" not in text:
            break
        time.sleep(1)
    assert "ORCHID-42" not in text

    # deleting the bot switches the widget off
    assert owner.delete(f"/bots/{bot['id']}").status_code == 204
    assert http.get(f"/chat/{bot['publicKey']}/info").status_code == 404
    assert http.post(f"/chat/{bot['publicKey']}", json={"message": "hi"}).status_code == 404


def test_tenants_are_isolated_end_to_end(http, tenant_factory):
    alice, bob = tenant_factory("Alice Shop"), tenant_factory("Bob Shop")
    alice_bot = alice.create_bot("Alice Bot")
    bob_bot = bob.create_bot("Bob Bot")
    a_doc = alice.upload(alice_bot["id"], "a.txt", b"Alice's vault combination is TULIP-7731.")
    b_doc = bob.upload(bob_bot["id"], "b.txt", b"Bob sells mountain bikes and repairs flat tyres.")
    assert alice.wait_for_document(alice_bot["id"], a_doc["id"])["status"] == "Ready"
    assert bob.wait_for_document(bob_bot["id"], b_doc["id"])["status"] == "Ready"

    # management API: Bob cannot see or touch Alice's data
    assert [b["id"] for b in bob.get("/bots").json()] == [bob_bot["id"]]
    assert bob.get(f"/bots/{alice_bot['id']}").status_code == 404
    assert bob.get(f"/bots/{alice_bot['id']}/documents").status_code == 404
    assert bob.delete(f"/bots/{alice_bot['id']}/documents/{a_doc['id']}").status_code == 404
    assert bob.put(f"/bots/{alice_bot['id']}", json={"name": "pwned"}).status_code == 404
    assert alice.get(f"/bots/{alice_bot['id']}").json()["name"] == "Alice Bot"

    # retrieval: Bob's bot can never answer with Alice's knowledge
    leak = chat(http, bob_bot["publicKey"], "What is the vault combination?")
    assert "TULIP" not in leak["text"]
    assert "TULIP-7731" in chat(http, alice_bot["publicKey"], "What is the vault combination?")["text"]


def blank_pdf() -> bytes:
    """A valid one-page PDF without any text (like a scanned image)."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 4\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref
    return bytes(out)


def test_document_without_text_fails_and_can_be_retried(tenant_factory):
    owner = tenant_factory()
    bot = owner.create_bot()
    doc = owner.upload(bot["id"], "scan.pdf", blank_pdf(), "application/pdf")
    failed = owner.wait_for_document(bot["id"], doc["id"])
    assert failed["status"] == "Failed"
    assert "No text" in failed["error"]

    retry = owner.post(f"/bots/{bot['id']}/documents/{doc['id']}/reprocess")
    assert retry.status_code == 202 and retry.json()["status"] == "Uploaded"
    assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Failed"


def test_damaged_file_fails_with_a_readable_reason(tenant_factory):
    owner = tenant_factory()
    bot = owner.create_bot()
    doc = owner.upload(bot["id"], "broken.pdf", b"%PDF-1.4 truncated garbage", "application/pdf")
    failed = owner.wait_for_document(bot["id"], doc["id"])
    assert failed["status"] == "Failed"
    assert "could not be read" in failed["error"]
    assert "startxref" not in failed["error"]


def test_bot_settings_update_reaches_the_widget(http, tenant_factory):
    owner = tenant_factory()
    bot = owner.create_bot("Old Name", "Old welcome")
    res = owner.put(f"/bots/{bot['id']}", json={"name": "New Name", "welcomeMessage": "New welcome"})
    assert res.status_code == 200
    assert http.get(f"/chat/{bot['publicKey']}/info").json() == {"name": "New Name", "welcomeMessage": "New welcome"}


def test_bot_without_documents_says_it_has_no_information(http, tenant_factory):
    bot = tenant_factory().create_bot()
    answer = chat(http, bot["publicKey"], "Hello?")
    assert answer["done"] and answer["meta"]["sources"] == 0
    assert "don't have any information" in answer["text"]


@pytest.mark.parametrize("path", [
    "/internal/bots/bk_x",
    "/api/internal/bots/bk_x",
    "/api/bots/../internal/bots/bk_x",
    "/api/chat/%2e%2e/internal/bots/bk_x",
])
def test_internal_endpoints_are_not_reachable_from_outside(path):
    assert httpx.get(f"{GATEWAY}{path}", headers={"X-Internal-Key": "guess"}).status_code == 404


def test_management_api_requires_login(http):
    assert http.get("/bots").status_code == 401
    assert http.get("/bots", headers={"Authorization": "Bearer forged.token.value"}).status_code == 401
    assert http.get("/auth/me").status_code == 401


def test_wrong_password_is_rejected(http, tenant_factory):
    owner = tenant_factory()
    assert http.post("/auth/login", json={"email": owner.email, "password": "wrong-password"}).status_code == 401


def test_cors_policy(http):
    evil = http.options("/bots", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in evil.headers
    dash = http.options("/bots", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET",
                                          "Access-Control-Request-Headers": "authorization"})
    assert dash.headers["access-control-allow-origin"] == "http://localhost:3000"
    site = http.options("/chat/bk_x", headers={"Origin": "https://any-customer.example",
                                               "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "content-type"})
    assert site.headers["access-control-allow-origin"] == "*"


def test_widget_bundle_is_served():
    res = httpx.get(f"{GATEWAY}/widget.js")
    assert res.status_code == 200
    assert "javascript" in res.headers["content-type"]
    assert res.headers["access-control-allow-origin"] == "*"
    assert "data-botforge" in res.text or "botforge" in res.text.lower()


def test_malformed_and_unknown_bot_keys(http):
    assert http.post("/chat/not-a-key", json={"message": "hi"}).status_code == 404
    assert http.get(f"/chat/bk_{'0' * 32}/info").status_code == 404
    assert http.post(f"/chat/bk_{'0' * 32}", json={"message": ""}).status_code == 422
