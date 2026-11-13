"""Level 3: Phase 2 features through the gateway with every real service (ingestion, pgvector, Gemini)."""
import time
import uuid

from conftest import DASHBOARD, chat

FAQ = (b"Harbor Coffee FAQ\n\nParking: there is a car park next to the building.\n\n"
       b"We are open every day from 6am to 8pm. Our loyalty code is MAPLE-913.\n")


def ready_bot(owner, name="Phase2 Bot", files=(("faq.txt", FAQ, "text/plain"),)):
    bot = owner.create_bot(name)
    for filename, content, kind in files:
        doc = owner.upload(bot["id"], filename, content, kind)
        assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Ready"
    return bot


def test_answers_show_their_source_and_playground_is_not_stored(http, tenant_factory):
    owner = tenant_factory("Sources Co")
    bot = ready_bot(owner)
    answer = chat(http, bot["publicKey"], "What is the loyalty code?", extra={"playground": True})
    assert "MAPLE-913" in answer["text"]
    assert answer["sources"] and answer["sources"][0]["name"] == "faq.txt"
    assert owner.get(f"/bots/{bot['id']}/conversations").json() == []


def test_owner_answers_beat_the_documents(http, tenant_factory):
    owner = tenant_factory("QA Co")
    bot = ready_bot(owner)
    res = owner.post(f"/bots/{bot['id']}/qa", json={"question": "Is parking free?",
                                                     "answer": "Yes, parking is free for customers after 7 PM."})
    assert res.status_code == 201
    deadline, text = time.time() + 30, ""
    while time.time() < deadline:   # the Q&A is embedded asynchronously by the ingestion worker
        text = chat(http, bot["publicKey"], "Is parking free?")["text"]
        if "7" in text:
            break
        time.sleep(2)
    assert "7" in text


def test_spreadsheet_rows_are_answered_with_their_columns(http, tenant_factory):
    owner = tenant_factory("Sheet Co")
    csv = b"Course,Annual fee,Duration\nJEE,68000,2 years\nNEET,62000,2 years\nFoundation,38000,1 year\n"
    bot = ready_bot(owner, files=(("fees.csv", csv, "text/csv"),))
    answer = chat(http, bot["publicKey"], "What is the annual fee for NEET?")
    assert "62" in answer["text"]


def test_exact_codes_are_found(http, tenant_factory):
    owner = tenant_factory("Code Co")
    filler = "\n\n".join(f"Section {i}: general information about our shop, staff and friendly service." for i in range(30))
    bot = ready_bot(owner, files=(("big.txt", (filler + "\n\nThe hostel refund needs form ZX-4471.").encode(), "text/plain"),))
    assert "ZX-4471" in chat(http, bot["publicKey"], "Which form do I need, ZX-4471?")["text"] or \
        "4471" in chat(http, bot["publicKey"], "Which form is needed for the hostel refund?")["text"]


def test_settings_reach_the_widget(http, tenant_factory):
    owner = tenant_factory("Look Co")
    bot = owner.create_bot("Look Bot")
    res = owner.put(f"/bots/{bot['id']}", json={"name": "Look Bot", "widgetColor": "#0f766e", "widgetPosition": "left",
                                                 "leadCaptureEnabled": True, "leadTiming": "start", "leadAskEmail": True,
                                                 "hoursEnabled": True, "tone": "professional"})
    assert res.status_code == 200, res.text
    info = http.get(f"/chat/{bot['publicKey']}/info").json()
    assert info["appearance"]["color"] == "#0f766e" and info["appearance"]["position"] == "left"
    assert info["leadCapture"]["timing"] == "start" and info["leadCapture"]["askEmail"] is True
    assert info["hours"]["enabled"] is True
    assert "tone" not in str(info)   # personality stays private (only the chat service uses it)


def test_unanswered_questions_can_be_answered(http, tenant_factory):
    owner = tenant_factory("Gap Co")
    bot = owner.create_bot("Gap Bot")   # no documents: every question is unanswered
    chat(http, bot["publicKey"], "Do you have a hostel?", conversation_id=str(uuid.uuid4()))
    gaps = owner.get(f"/bots/{bot['id']}/unanswered").json()
    assert gaps[0]["question"] == "Do you have a hostel?"
    owner.post(f"/bots/{bot['id']}/qa", json={"question": "Hostel?", "answer": "Yes.", "fromQuestion": gaps[0]["question"]})
    assert owner.get(f"/bots/{bot['id']}/unanswered").json() == []


def test_website_source_is_crawled(http, tenant_factory):
    """Crawls the local demo website (dev.ps1 allows private addresses locally; production blocks them)."""
    owner = tenant_factory("Crawl Co")
    bot = owner.create_bot("Crawl Bot")
    res = owner.post(f"/bots/{bot['id']}/sources", json={"kind": "website", "url": f"{DASHBOARD}/demo", "syncIntervalDays": 0})
    assert res.status_code == 202, res.text
    doc = owner.wait_for_document(bot["id"], res.json()["id"], timeout=240)
    assert doc["status"] == "Ready", doc
    answer = chat(http, bot["publicKey"], "How much is the NEET programme per year?")
    assert "62" in answer["text"]
    assert any(s.get("url", "").startswith(DASHBOARD) for s in answer["sources"])


def test_unsafe_sources_are_rejected(tenant_factory):
    owner = tenant_factory("Unsafe Co")
    bot = owner.create_bot()
    for body in ({"kind": "website", "url": "file:///etc/passwd"}, {"kind": "google", "url": "https://evil.example/x"},
                 {"kind": "notion", "url": "https://www.notion.so/x-0123456789abcdef0123456789abcdef"}):
        assert owner.post(f"/bots/{bot['id']}/sources", json=body).status_code == 400
