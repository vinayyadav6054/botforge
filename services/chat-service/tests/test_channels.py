"""Unit tests for messaging-app webhooks (WhatsApp, Instagram, Messenger, Telegram), every outside call faked."""
import hashlib
import hmac
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app import bots_client, channels, main
from app.retrieval import Retrieved

pytestmark = pytest.mark.unit

KEY = "bk_" + "c" * 32
BOT = {"botId": str(uuid.uuid4()), "tenantId": str(uuid.uuid4()), "name": "Sunrise Assistant", "welcomeMessage": "Namaste!",
       "suggestedQuestions": ["Fees?"], "leadCapture": {"enabled": True}, "showSources": True, "active": True}


def make_channel(kind: str) -> dict:
    secrets = {"telegram": {"token": "123:abc"},
               "whatsapp": {"accessToken": "EAAG", "appSecret": "app-secret", "phoneNumberId": "1098"},
               "messenger": {"pageToken": "EAAP", "appSecret": "app-secret", "pageId": "555"},
               "instagram": {"pageToken": "EAAP", "appSecret": "app-secret", "pageId": "555", "igUserId": "1784"}}[kind]
    external = {"telegram": "777", "whatsapp": "1098", "messenger": "555", "instagram": "1784"}[kind]
    return {"id": str(uuid.uuid4()), "kind": kind, "botPublicKey": KEY, "externalId": external,
            "verifyToken": "verify-me", "webhookSecret": "tg-secret", "secrets": secrets}


@pytest.fixture
def world(monkeypatch):
    state = {"channels": {}, "sent": [], "turns": [], "leads": [], "history": [], "status": [], "answer": "The fee is ₹68,000.",
             "chunks": [Retrieved("JEE fee 68,000", 0.9, "Fees.pdf", "page 2")], "quota": None, "transcript": "fees kitni hai?"}
    channels._seen.clear()
    channels._recent.clear()

    async def get_channel(cid):
        return state["channels"].get(cid)

    async def resolve_bot(key):
        return state.get("bot", BOT)

    async def recent_turns(cid, take=10):
        return state["history"]

    async def record_turn(key, turn):
        state["turns"].append(turn)

    async def create_lead(key, lead):
        state["leads"].append(lead)

    async def channel_status(cid, error):
        state["status"].append(error)

    async def send_text(channel, user, text):
        state["sent"].append((channel["kind"], user, text))

    async def nothing(*a, **k):
        return None

    async def find_chunks(bot, question, history):
        state["question"] = question
        return state["chunks"]

    async def check_quota(key):
        return state["quota"]

    async def stream_answer(name, question, chunks, history=None, style=None, actions=None):
        state["llm_history"] = history
        yield state["answer"]

    async def download_audio(channel, audio):
        return b"OggS", "audio/ogg"

    async def transcribe(audio, mime):
        return state["transcript"]

    for name, fn in [("get_channel", get_channel), ("resolve_bot", resolve_bot), ("recent_turns", recent_turns),
                     ("record_turn", record_turn), ("create_lead", create_lead), ("channel_status", channel_status)]:
        monkeypatch.setattr(bots_client, name, fn)
    monkeypatch.setattr(channels, "send_text", send_text)
    monkeypatch.setattr(channels, "show_typing", nothing)
    monkeypatch.setattr(channels, "download_audio", download_audio)
    monkeypatch.setattr(main, "find_chunks", find_chunks)
    monkeypatch.setattr(main, "check_quota", check_quota)
    monkeypatch.setattr(main, "stream_answer", stream_answer)
    monkeypatch.setattr(main, "transcribe", transcribe)
    monkeypatch.setattr(main, "give_back", nothing)
    monkeypatch.setattr(main, "get_model", lambda: None)
    return state


@pytest.fixture
def client(world):
    with TestClient(main.app) as c:
        yield c


def add(world, kind):
    ch = make_channel(kind)
    world["channels"][ch["id"]] = ch
    return ch


def signed(body: dict, secret="app-secret"):
    raw = json.dumps(body).encode()
    return raw, {"Content-Type": "application/json",
                 "X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()}


def whatsapp_msg(text=None, audio=False, mid="wamid.1", phone_id="1098"):
    m = {"from": "919820012345", "id": mid, "type": "audio" if audio else "text"}
    if audio:
        m["audio"] = {"id": "MEDIA1", "mime_type": "audio/ogg; codecs=opus"}
    else:
        m["text"] = {"body": text}
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": phone_id}, "contacts": [{"wa_id": "919820012345", "profile": {"name": "Rohan"}}],
        "messages": [m]}}]}]}


# ---------- verification and authentication ----------

def test_meta_webhook_verification(client, world):
    ch = add(world, "whatsapp")
    ok = client.get(f"/channels/whatsapp/{ch['id']}", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "12345"})
    assert ok.status_code == 200 and ok.text == "12345"
    bad = client.get(f"/channels/whatsapp/{ch['id']}", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"})
    assert bad.status_code == 403


def test_unknown_or_mismatched_channels_are_404(client, world):
    ch = add(world, "whatsapp")
    assert client.post(f"/channels/telegram/{ch['id']}", json={}).status_code == 404
    assert client.post(f"/channels/whatsapp/{uuid.uuid4()}", json={}).status_code == 404
    assert client.post("/channels/whatsapp/not-a-uuid", json={}).status_code == 404
    assert client.post(f"/channels/sms/{ch['id']}", json={}).status_code == 404


def test_meta_requests_must_be_signed_with_the_app_secret(client, world):
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("hi"), secret="someone-else")
    assert client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers).status_code == 401
    assert client.post(f"/channels/whatsapp/{ch['id']}", json=whatsapp_msg("hi")).status_code == 401
    assert world["sent"] == []


def test_telegram_requests_need_the_secret_token(client, world):
    ch = add(world, "telegram")
    update = {"message": {"message_id": 1, "from": {"id": 42, "first_name": "Rohan"}, "chat": {"id": 42}, "text": "Fees?"}}
    assert client.post(f"/channels/telegram/{ch['id']}", json=update).status_code == 401
    assert client.post(f"/channels/telegram/{ch['id']}", json=update,
                       headers={"X-Telegram-Bot-Api-Secret-Token": "tg-secret"}).status_code == 200
    assert world["sent"] == [("telegram", "42", "The fee is ₹68,000.\n\n📄 Source: Fees.pdf (page 2)")]


# ---------- answering ----------

def test_whatsapp_message_is_answered_logged_and_becomes_a_lead(client, world):
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("What is the JEE fee?"))
    assert client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers).status_code == 200

    assert world["sent"][0][:2] == ("whatsapp", "919820012345")
    turn = world["turns"][0]
    assert (turn["channel"], turn["contactName"], turn["contactId"], turn["answered"]) == ("whatsapp", "Rohan", "919820012345", True)
    assert turn["conversationId"] == channels.conversation_id(ch["id"], "919820012345")
    assert world["leads"][0]["phone"] == "+919820012345" and world["leads"][0]["channel"] == "whatsapp"
    assert world["status"] == [None]


def test_follow_up_messages_use_history_and_do_not_create_more_leads(client, world):
    ch = add(world, "whatsapp")
    world["history"] = [{"role": "user", "text": "Fees?"}, {"role": "assistant", "text": "₹68,000."}]
    raw, headers = signed(whatsapp_msg("And for NEET?", mid="wamid.2"))
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    assert world["llm_history"] == [("user", "Fees?"), ("assistant", "₹68,000.")]
    assert world["leads"] == []


def test_retried_webhooks_are_answered_once(client, world):
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("hi", mid="wamid.same"))
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    assert len(world["sent"]) == 1


def test_messages_for_another_number_are_ignored(client, world):
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("hi", phone_id="9999"))
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    assert world["sent"] == []


def test_voice_notes_are_transcribed_and_answered(client, world):
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg(audio=True, mid="wamid.voice"))
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    assert world["question"] == "fees kitni hai?"
    assert world["turns"][0]["question"] == "fees kitni hai?"


def test_no_knowledge_limit_and_inactive_plans(client, world):
    ch = add(world, "telegram")
    tg = {"X-Telegram-Bot-Api-Secret-Token": "tg-secret"}

    def send(text, n):
        client.post(f"/channels/telegram/{ch['id']}", headers=tg,
                    json={"message": {"message_id": n, "from": {"id": 7}, "chat": {"id": 7}, "text": text}})
        return world["sent"][-1][2]

    world["chunks"] = []
    assert send("Hostel?", 1) == main.NO_INFORMATION and world["turns"][-1]["answered"] is False
    world["chunks"] = [Retrieved("x", 1.0)]
    world["quota"] = main.LIMIT_REACHED
    assert send("Fees?", 2) == main.LIMIT_REACHED
    world["bot"] = {**BOT, "active": False}
    assert send("Fees?", 3) == main.NOT_AVAILABLE


def test_telegram_start_command_sends_the_welcome(client, world):
    ch = add(world, "telegram")
    client.post(f"/channels/telegram/{ch['id']}", headers={"X-Telegram-Bot-Api-Secret-Token": "tg-secret"},
                json={"message": {"message_id": 9, "from": {"id": 5}, "chat": {"id": 5}, "text": "/start"}})
    assert world["sent"][0][2] == "Namaste!\n\nYou can ask, for example:\n• Fees?"
    assert world["turns"] == []


def test_instagram_and_messenger_ignore_echoes_and_use_the_page_token(client, world):
    for kind, obj in (("instagram", "instagram"), ("messenger", "page")):
        ch = add(world, kind)
        body = {"object": obj, "entry": [{"messaging": [
            {"sender": {"id": "U1"}, "recipient": {"id": ch["externalId"]}, "message": {"mid": f"m-{kind}", "text": "Timings?"}},
            {"sender": {"id": ch["externalId"]}, "recipient": {"id": "U1"}, "message": {"mid": f"e-{kind}", "text": "echo", "is_echo": True}},
        ]}]}
        raw, headers = signed(body)
        client.post(f"/channels/{kind}/{ch['id']}", content=raw, headers=headers)
    assert [(k, u) for k, u, _ in world["sent"]] == [("instagram", "U1"), ("messenger", "U1")]
    assert world["leads"] == []   # no phone number on Instagram/Messenger


def test_floods_from_one_customer_are_dropped(client, world, monkeypatch):
    monkeypatch.setattr(channels, "PER_USER_PER_MINUTE", 2)
    ch = add(world, "telegram")
    for n in range(4):
        client.post(f"/channels/telegram/{ch['id']}", headers={"X-Telegram-Bot-Api-Secret-Token": "tg-secret"},
                    json={"message": {"message_id": 100 + n, "from": {"id": 8}, "chat": {"id": 8}, "text": f"q{n}"}})
    assert len(world["sent"]) == 2


def test_send_failures_are_reported_to_the_dashboard(client, world, monkeypatch):
    async def failing(channel, user, text):
        raise RuntimeError("whatsapp refused the reply (401)")
    monkeypatch.setattr(channels, "send_text", failing)
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("hi", mid="wamid.fail"))
    client.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers)
    assert "refused" in world["status"][0]


def test_long_replies_are_split_for_each_app():
    sent = []

    class FakeHttp:
        async def post(self, url, **kw):
            sent.append(kw["json"]["text"] if "chat_id" in kw["json"] else kw["json"])

            class R:
                status_code = 200
                text = ""
            return R()

    import asyncio
    channels._http, original = FakeHttp(), channels._http
    try:
        asyncio.run(channels.send_text(make_channel("telegram"), "1", "x" * 9000))
    finally:
        channels._http = original
    assert [len(s) for s in sent] == [4000, 4000, 1000]
