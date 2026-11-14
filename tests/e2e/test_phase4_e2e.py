"""Level 3: Phase 4 sales features through the gateway with every real service and Gemini.

Lead alerts: a webhook received by a local server (the stack runs in Development, where webhooks may reach
private addresses) and a test email (locally written to the identity log). Booking and UPI buttons in the chat.
"""
import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from conftest import chat

HOOK_PORT = 5998
FAQ = b"Sunrise Academy\n\nJEE coaching costs Rs 68,000 per year. Classes run from 7am to 7pm.\n"


class Hook(BaseHTTPRequestHandler):
    received: list = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        Hook.received.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")


@pytest.fixture(scope="module")
def hook():
    try:
        server = ThreadingHTTPServer(("127.0.0.1", HOOK_PORT), Hook)
    except OSError:
        pytest.skip(f"port {HOOK_PORT} busy")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield Hook.received
    server.shutdown()


def wait_for(received, path, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for item in list(received):
            if item[0] == path:
                return item
        time.sleep(0.3)
    raise AssertionError(f"webhook {path} not called within {timeout}s")


def test_new_lead_reaches_the_webhook_signed(http, tenant_factory, hook):
    owner = tenant_factory("Alerts Academy")
    bot = owner.create_bot("Alerts Bot")
    res = owner.put(f"/bots/{bot['id']}", json={"name": "Alerts Bot", "leadCaptureEnabled": True,
                                                "webhookUrl": f"http://127.0.0.1:{HOOK_PORT}/lead-1"})
    assert res.status_code == 200, res.text
    secret = res.json()["webhookSecret"]

    lead = {"name": "Asha", "phone": "9820012345", "course": "JEE",
            "transcript": [{"role": "user", "text": "Fees?"}, {"role": "assistant", "text": "Rs 68,000."}]}
    assert http.post(f"/chat/{bot['publicKey']}/lead", json=lead).status_code == 200

    _, headers, body = wait_for(hook, "/lead-1")
    expected = "sha256=" + hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    assert headers["X-Kahiye-Signature"] == expected
    data = json.loads(body)
    assert (data["event"], data["name"], data["phone"], data["course"], data["botName"]) == \
           ("lead.created", "Asha", "9820012345", "JEE", "Alerts Bot")
    assert data["transcript"] == "Visitor: Fees?\nBot: Rs 68,000."


def test_owner_can_test_email_and_webhook(tenant_factory, hook):
    owner = tenant_factory("Test Alerts")
    bot = owner.create_bot("Test Bot")
    assert owner.post(f"/bots/{bot['id']}/alerts/test", json={"kind": "email"}).json()["ok"] is True
    owner.put(f"/bots/{bot['id']}", json={"name": "Test Bot", "webhookUrl": f"http://127.0.0.1:{HOOK_PORT}/test-1"})
    result = owner.post(f"/bots/{bot['id']}/alerts/test", json={"kind": "webhook"}).json()
    assert result == {"ok": True, "status": 200, "error": None}
    assert json.loads(wait_for(hook, "/test-1")[2])["event"] == "lead.test"


def test_booking_and_upi_buttons_reach_the_widget_and_the_answers(http, tenant_factory):
    owner = tenant_factory("Buttons Academy")
    bot = owner.create_bot("Buttons Bot")
    doc = owner.upload(bot["id"], "faq.txt", FAQ)
    assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Ready"
    res = owner.put(f"/bots/{bot['id']}", json={
        "name": "Buttons Bot", "bookingUrl": "https://calendly.com/sunrise-demo/class",
        "bookingLabel": "Book a free demo class", "upiId": "sunrise@okaxis", "paymentLabel": "Pay fees"})
    assert res.status_code == 200, res.text

    actions = http.get(f"/chat/{bot['publicKey']}/info").json()["actions"]
    assert [(a["kind"], a["label"]) for a in actions] == [("booking", "Book a free demo class"), ("upi", "Pay fees")]
    assert actions[1]["url"] == "upi://pay?pa=sunrise%40okaxis&pn=Buttons%20Bot&cu=INR"

    text = chat(http, bot["publicKey"], "What are the fees for JEE? And how do I book a demo class?")["text"]
    assert "68,000" in text
    assert "calendly.com/sunrise-demo/class" in text or "Book a free demo class" in text, text
