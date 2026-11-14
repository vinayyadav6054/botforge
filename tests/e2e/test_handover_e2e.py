"""Level 3: human handover on the website chat, through the gateway with every real service and Gemini."""
import uuid

from conftest import chat

FAQ = b"Sunrise Academy\n\nThe office is open from 9am to 6pm. JEE coaching costs Rs 68,000 per year.\n"


def test_owner_takes_over_replies_and_hands_back(http, tenant_factory):
    owner = tenant_factory("Handover Academy")
    bot = owner.create_bot("Handover Bot")
    doc = owner.upload(bot["id"], "faq.txt", FAQ)
    assert owner.wait_for_document(bot["id"], doc["id"])["status"] == "Ready"
    key, cid = bot["publicKey"], str(uuid.uuid4())

    first = chat(http, key, "What does JEE coaching cost?", conversation_id=cid)
    assert "68,000" in first["text"]

    # the owner sees the chat, takes over and writes
    convo = owner.get(f"/bots/{bot['id']}/conversations").json()[0]
    assert (convo["id"], convo["human"]) == (cid, False)
    assert owner.post(f"/bots/{bot['id']}/conversations/{cid}/takeover").json()["human"] is True
    assert http.get(f"/chat/{key}/conversations/{cid}/updates").json() == {"human": True, "messages": []}

    # the visitor's next message reaches the owner, not the AI
    second = chat(http, key, "Can I visit today at 5?", conversation_id=cid)
    assert second["text"] == "" and second["done"]
    reply = owner.post(f"/bots/{bot['id']}/conversations/{cid}/reply", json={"text": "Yes, come at 5. Ask for Priya."})
    assert reply.status_code == 200, reply.text

    updates = http.get(f"/chat/{key}/conversations/{cid}/updates").json()
    assert updates["human"] is True
    assert [m["text"] for m in updates["messages"]] == ["Yes, come at 5. Ask for Priya."]
    after = updates["messages"][-1]["at"]
    assert http.get(f"/chat/{key}/conversations/{cid}/updates", params={"after": after}).json()["messages"] == []

    thread = owner.get(f"/bots/{bot['id']}/conversations/{cid}").json()
    assert [m["role"] for m in thread["messages"]] == ["user", "assistant", "user", "agent"]
    assert thread["human"] is True

    # handed back: the bot answers again
    owner.post(f"/bots/{bot['id']}/conversations/{cid}/release")
    third = chat(http, key, "Until what time is the office open?", conversation_id=cid)
    assert "6" in third["text"], third


def test_polling_is_public_but_scoped_to_the_conversation(http, tenant_factory):
    owner = tenant_factory("Scope Co")
    bot = owner.create_bot("Scope Bot")
    other = str(uuid.uuid4())
    assert http.get(f"/chat/{bot['publicKey']}/conversations/{other}/updates").json() == {"human": False, "messages": []}
    assert http.get(f"/chat/{bot['publicKey']}/conversations/nope/updates").status_code == 404
    assert http.post(f"/bots/{bot['id']}/conversations/{other}/takeover").status_code == 401   # owners only
