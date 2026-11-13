"""Level 3: plans, usage, conversation history, account flows and admin, through the gateway with every service."""
import os
import uuid

from conftest import chat

ADMIN_KEY = os.environ.get("BOTFORGE_ADMIN_KEY", "local-admin-key")
FAQ = b"Harbor Coffee FAQ\n\nWe are open every day from 6am to 8pm.\n\nOur loyalty code is MAPLE-913.\n"


def test_conversations_are_logged_and_answers_counted(http, tenant_factory):
    owner = tenant_factory("Harbor Coffee")
    bot = owner.create_bot("Coffee Bot")
    doc = owner.upload(bot["id"], "faq.txt", FAQ)
    assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Ready"
    assert owner.get("/account").json()["usage"]["answers"] == 0

    cid = str(uuid.uuid4())
    first = chat(http, bot["publicKey"], "What is the loyalty code?", conversation_id=cid)
    assert "MAPLE-913" in first["text"] and first["meta"]["conversationId"] == cid
    second = chat(http, bot["publicKey"], "Until what time are you open?", conversation_id=cid)
    assert second["done"] and not second["error"], second   # an AI timeout here is not a BotForge bug: rerun

    account = owner.get("/account").json()
    assert account["plan"]["id"] == "trial"
    assert account["usage"]["answers"] == 2

    conversations = owner.get(f"/bots/{bot['id']}/conversations").json()
    assert len(conversations) == 1
    assert conversations[0]["id"] == cid
    assert conversations[0]["messageCount"] == 4
    assert conversations[0]["firstQuestion"] == "What is the loyalty code?"
    thread = owner.get(f"/bots/{bot['id']}/conversations/{cid}").json()
    assert "MAPLE-913" in thread["messages"][1]["text"]

    # another business cannot read them
    stranger = tenant_factory("Stranger")
    assert stranger.get(f"/bots/{bot['id']}/conversations/{cid}").status_code == 404


def test_questions_without_documents_are_marked_unanswered(http, tenant_factory):
    owner = tenant_factory("Empty Co")
    bot = owner.create_bot("Empty Bot")
    cid = str(uuid.uuid4())
    chat(http, bot["publicKey"], "Do you deliver?", conversation_id=cid)
    summary = owner.get(f"/bots/{bot['id']}/conversations").json()[0]
    assert summary["unansweredCount"] == 1
    assert owner.get("/account").json()["usage"]["answers"] == 0   # no AI call, not counted


def test_trial_limits_bots_and_shows_the_badge(http, tenant_factory):
    owner = tenant_factory("Limit Co")
    bots = [owner.create_bot(f"Bot {i}") for i in range(3)]
    res = owner.post("/bots", json={"name": "Fourth"})
    assert res.status_code == 402 and res.json()["code"] == "plan_limit"
    assert http.get(f"/chat/{bots[0]['publicKey']}/info").json()["branding"]["show"] is True


def test_admin_activates_a_plan_and_the_badge_goes(http, tenant_factory):
    owner = tenant_factory("Paying Co")
    bot = owner.create_bot()
    assert http.get("/admin/tenants").status_code == 401
    assert http.get("/admin/subscriptions", headers={"X-Admin-Key": "wrong"}).status_code == 401

    admin = {"X-Admin-Key": ADMIN_KEY}
    tenants = http.get("/admin/tenants", headers=admin).json()
    assert any(t["owner"]["email"] == owner.email for t in tenants)
    res = http.put(f"/admin/subscriptions/{owner.tenant_id}", headers=admin, json={"plan": "business", "months": 1})
    assert res.status_code == 200, res.text
    assert owner.get("/account").json()["plan"]["id"] == "business"
    assert http.get(f"/chat/{bot['publicKey']}/info").json()["branding"]["show"] is False


def test_password_reset_and_verification_reject_bad_links(http, tenant_factory):
    owner = tenant_factory("Reset Co")
    assert http.post("/auth/forgot-password", json={"email": owner.email}).status_code == 200
    assert http.post("/auth/forgot-password", json={"email": "nobody-x@example.com"}).status_code == 200
    assert http.post("/auth/reset-password", json={"token": "nope", "password": "N3w-password!"}).status_code == 400
    assert http.post("/auth/verify-email", json={"token": "nope"}).status_code == 400
    assert owner.get("/auth/me").json()["emailVerified"] is False


def test_export_and_account_deletion(http, tenant_factory):
    owner = tenant_factory("Leaving Co")
    bot = owner.create_bot("Leaving Bot")
    assert owner.get("/auth/export").json()["business"]["name"] == "Leaving Co"
    assert owner.get("/account/export").json()["bots"][0]["bot"]["name"] == "Leaving Bot"

    assert owner.post("/auth/delete-account", json={"password": "wrong"}).status_code == 400
    assert owner.post("/auth/delete-account", json={"password": owner.password}).status_code == 204
    assert http.post("/auth/login", json={"email": owner.email, "password": owner.password}).status_code == 401
    assert http.get(f"/chat/{bot['publicKey']}/info").status_code == 404
