"""Level 3: Indian languages, voice and messaging apps, through the gateway with every real service and Gemini.

Messaging apps run against a fake Telegram/Meta server started here; the stack must be started with
FAKE_PLATFORM_URL=http://localhost:5999 (see scripts/dev.ps1), otherwise those tests are skipped.
"""
import hashlib
import hmac
import json
import os
import platform
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import GATEWAY, chat

FAQ = b"Harbor Coffee FAQ\n\nWe are open every day from 6am to 8pm. Our loyalty code is MAPLE-913.\n"
FAKE_PORT = 5999


def ready_bot(owner, name="Phase3 Bot"):
    bot = owner.create_bot(name)
    doc = owner.upload(bot["id"], "faq.txt", FAQ)
    assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Ready"
    return bot


# ---------- languages ----------

def test_hinglish_question_finds_english_documents(http, tenant_factory):
    bot = ready_bot(tenant_factory("Hinglish Co"))
    assert "MAPLE-913" in chat(http, bot["publicKey"], "loyalty code kya hai?")["text"]


def test_hindi_question_gets_a_hindi_answer(http, tenant_factory):
    bot = ready_bot(tenant_factory("Hindi Co"))
    text = chat(http, bot["publicKey"], "आप किस समय खुलते हैं?")["text"]
    assert any("ऀ" <= ch <= "ॿ" for ch in text), text   # Devanagari reply
    assert "6" in text or "६" in text


def test_owner_can_force_the_reply_language(http, tenant_factory):
    owner = tenant_factory("Tamil Co")
    bot = ready_bot(owner)
    owner.put(f"/bots/{bot['id']}", json={"name": bot["name"], "replyLanguage": "ta"})
    text = chat(http, bot["publicKey"], "What is the loyalty code?")["text"]
    assert "MAPLE-913" in text and any("஀" <= ch <= "௿" for ch in text), text
    assert http.get(f"/chat/{bot['publicKey']}/info").json()["language"] == "ta"


# ---------- voice ----------

@pytest.mark.skipif(platform.system() != "Windows", reason="uses Windows speech synthesis to make a real recording")
def test_spoken_question_is_transcribed(http, tenant_factory):
    bot = tenant_factory("Voice Co").create_bot()
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "q.wav")
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                        f"$s.SetOutputToWaveFile('{wav}'); $s.Speak('What time do you open on Sunday?'); $s.Dispose()"],
                       check=True, timeout=60)
        audio = open(wav, "rb").read()
    res = http.post(f"/chat/{bot['publicKey']}/transcribe", content=audio, headers={"Content-Type": "audio/wav"})
    assert res.status_code == 200, res.text
    assert "sunday" in res.json()["text"].lower()


# ---------- messaging apps (fake platform) ----------

class FakePlatform(BaseHTTPRequestHandler):
    calls: list = []

    def log_message(self, *args):
        pass

    def _reply(self, body: dict, status=200):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        FakePlatform.calls.append(("GET", self.path, ""))
        if "/getMe" in self.path:
            return self._reply({"ok": True, "result": {"id": int(time.time() * 1000) % 10**9, "username": "harbor_test_bot"}})
        if "fields=display_phone_number" in self.path:
            return self._reply({"display_phone_number": "+91 90000 00000"})
        return self._reply({}, 404)

    def do_POST(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":   # .NET's JSON posts
            data = bytearray()
            while True:
                size = int(self.rfile.readline().strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    break
                data += self.rfile.read(size)
                self.rfile.readline()
            body = data.decode()
        else:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length).decode() if length else ""
        FakePlatform.calls.append(("POST", self.path, body))
        return self._reply({"ok": True, "result": True, "messages": [{"id": "wamid.out"}]})


@pytest.fixture(scope="module")
def fake_platform(http):
    try:
        server = ThreadingHTTPServer(("127.0.0.1", FAKE_PORT), FakePlatform)
    except OSError:
        pytest.skip(f"port {FAKE_PORT} busy")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield FakePlatform.calls
    server.shutdown()


def wait_for_reply(calls, path_part, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for method, path, body in calls:
            if method == "POST" and path_part in path and body:
                calls.remove((method, path, body))
                return json.loads(body)
        time.sleep(0.5)
    raise AssertionError(f"no {path_part} call within {timeout}s")


def connect_or_skip(owner, bot_id, body):
    res = owner.post(f"/bots/{bot_id}/channels", json=body)
    if res.status_code == 400 and "online" in res.text:
        pytest.skip("start the stack with FAKE_PLATFORM_URL=http://localhost:5999 to test messaging apps")
    assert res.status_code == 201, res.text
    return res.json()


def test_telegram_message_is_answered_through_the_app(http, tenant_factory, fake_platform):
    owner = tenant_factory("Telegram Co")
    bot = ready_bot(owner, "Telegram Bot")
    channel = connect_or_skip(owner, bot["id"], {"kind": "telegram", "token": f"{int(time.time()) % 10**9}:AAH-abcdefghijklmnopqrstuvwxyz0123456"})
    hook = wait_for_reply(fake_platform, "/setWebhook")
    assert hook["url"].endswith(f"/api/channels/telegram/{channel['id']}")

    update = {"update_id": 1, "message": {"message_id": 11, "from": {"id": 4242, "first_name": "Asha"},
                                          "chat": {"id": 4242, "type": "private"}, "text": "What is the loyalty code?"}}
    assert http.post(f"/channels/telegram/{channel['id']}", json=update).status_code == 401   # no secret
    res = http.post(f"/channels/telegram/{channel['id']}", json=update,
                    headers={"X-Telegram-Bot-Api-Secret-Token": hook["secret_token"]})
    assert res.status_code == 200
    reply = wait_for_reply(fake_platform, "/sendMessage")
    assert reply["chat_id"] == "4242" and "MAPLE-913" in reply["text"]

    convo = owner.get(f"/bots/{bot['id']}/conversations").json()[0]
    assert (convo["channel"], convo["contactName"]) == ("telegram", "Asha")


def test_whatsapp_message_becomes_a_lead(http, tenant_factory, fake_platform):
    owner = tenant_factory("WhatsApp Co")
    bot = ready_bot(owner, "WA Bot")
    owner.put(f"/bots/{bot['id']}", json={"name": "WA Bot", "leadCaptureEnabled": True})
    phone_id = str(int(time.time() * 1000) % 10**12)
    channel = connect_or_skip(owner, bot["id"], {"kind": "whatsapp", "phoneNumberId": phone_id,
                                                 "accessToken": "EAAG" + "x" * 40, "appSecret": "wa-app-secret"})
    verify = http.get(f"/channels/whatsapp/{channel['id']}",
                      params={"hub.mode": "subscribe", "hub.verify_token": channel["verifyToken"], "hub.challenge": "777"})
    assert verify.text == "777"

    payload = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": phone_id}, "contacts": [{"wa_id": "919811122233", "profile": {"name": "Rohan"}}],
        "messages": [{"from": "919811122233", "id": f"wamid.{time.time()}", "type": "text",
                      "text": {"body": "Until what time are you open?"}}]}}]}]}
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(b"wa-app-secret", raw, hashlib.sha256).hexdigest()
    res = http.post(f"/channels/whatsapp/{channel['id']}", content=raw,
                    headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig})
    assert res.status_code == 200
    reply = wait_for_reply(fake_platform, f"/{phone_id}/messages")
    assert reply["to"] == "919811122233" and "8" in reply["text"]["body"]

    deadline = time.time() + 15
    while time.time() < deadline and not owner.get(f"/bots/{bot['id']}/leads").json():
        time.sleep(0.5)
    lead = owner.get(f"/bots/{bot['id']}/leads").json()[0]
    assert (lead["name"], lead["phone"], lead["channel"]) == ("Rohan", "+919811122233", "whatsapp")


def test_unsigned_meta_webhooks_are_rejected(http, tenant_factory, fake_platform):
    owner = tenant_factory("Unsigned Co")
    bot = owner.create_bot()
    channel = connect_or_skip(owner, bot["id"], {"kind": "whatsapp", "phoneNumberId": str(int(time.time() * 997) % 10**12),
                                                 "accessToken": "EAAG" + "y" * 40, "appSecret": "real-secret"})
    assert http.post(f"/channels/whatsapp/{channel['id']}", json={"object": "whatsapp_business_account"}).status_code == 401
