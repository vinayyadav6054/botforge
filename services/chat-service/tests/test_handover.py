"""Human handover in the chat service: the AI stays quiet while a person from the business replies."""
import pytest
from fastapi.testclient import TestClient

from app import channels, config, main
from tests.test_channels import add, signed, whatsapp_msg, world  # noqa: F401  (fixtures)
from tests.test_unit import KEY, fakes, parse_sse  # noqa: F401  (fixtures)

pytestmark = pytest.mark.unit
CID = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"


@pytest.fixture
def web(fakes):  # noqa: F811
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def apps(world):  # noqa: F811
    with TestClient(main.app) as c:
        yield c


def test_website_message_goes_to_the_person_not_the_ai(web, fakes):  # noqa: F811
    fakes["human"] = True
    res = web.post(f"/chat/{KEY}", json={"message": "Can I come at 5?", "conversationId": CID})
    events = [e for e, _ in parse_sse(res.text)]
    assert events == ["meta", "handover", "done"]
    assert fakes["llm_calls"] == [] and fakes["consumed"] == 0       # no AI answer, nothing counted
    assert fakes["turns"] == [{"conversationId": CID, "question": "Can I come at 5?", "answer": None,
                               "visitorOnly": True, "pageUrl": None}]


def test_without_a_takeover_the_bot_answers(web, fakes):  # noqa: F811
    res = web.post(f"/chat/{KEY}", json={"message": "Open on Sunday?", "conversationId": CID})
    assert "token" in [e for e, _ in parse_sse(res.text)]


def test_widget_polls_for_the_owners_replies(web, fakes, monkeypatch):  # noqa: F811
    calls = []

    async def updates(key, cid, after=None):
        calls.append((key, cid, after))
        return {"human": True, "messages": [{"text": "Hi, Priya here.", "createdAt": "2026-11-14T10:00:00Z"}, {"bad": 1}]}

    monkeypatch.setattr(main, "conversation_updates", updates)
    body = web.get(f"/chat/{KEY}/conversations/{CID}/updates", params={"after": "2026-11-14T09:59:00.123Z"}).json()
    assert body == {"human": True, "messages": [{"text": "Hi, Priya here.", "at": "2026-11-14T10:00:00Z"}]}
    assert calls == [(KEY, CID, "2026-11-14T09:59:00.123Z")]
    assert web.get(f"/chat/{KEY}/conversations/not-a-uuid/updates").status_code == 404
    assert web.get(f"/chat/bk_x/conversations/{CID}/updates").status_code == 404
    assert web.get(f"/chat/{KEY}/conversations/{CID}/updates", params={"after": "<script>"}).status_code == 400


def test_messaging_app_message_is_stored_without_a_reply(apps, world):  # noqa: F811
    world["human"] = True
    ch = add(world, "whatsapp")
    raw, headers = signed(whatsapp_msg("Is the counsellor there?", mid="wamid.h1"))
    assert apps.post(f"/channels/whatsapp/{ch['id']}", content=raw, headers=headers).status_code == 200
    assert world["sent"] == []
    turn = world["turns"][0]
    assert (turn["visitorOnly"], turn["answer"], turn["contactId"]) == (True, None, "919820012345")
    assert world["leads"] == []


def test_owner_reply_is_sent_through_the_app(apps, world, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "INTERNAL_API_KEY", "k")
    ch = add(world, "telegram")
    url = f"/internal/channels/{ch['id']}/send"
    assert apps.post(url, json={"to": "42", "text": "hello"}).status_code == 401
    assert apps.post(url, json={"to": "42", "text": "hello"}, headers={"X-Internal-Key": "wrong"}).status_code == 401
    assert apps.post(url, json={"to": "42", "text": "Calling you now."}, headers={"X-Internal-Key": "k"}).json() == {"sent": True}
    assert world["sent"][-1][:3] == ("telegram", "42", "Calling you now.")
    assert apps.post("/internal/channels/3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/send", json={"to": "1", "text": "x"},
                     headers={"X-Internal-Key": "k"}).status_code == 404


def test_whatsapp_24_hour_rule_is_explained(apps, world, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "INTERNAL_API_KEY", "k")

    async def refused(channel, user, text):
        raise RuntimeError('whatsapp refused the reply (400): {"error":{"code":131047,"message":"Re-engagement message"}}')

    monkeypatch.setattr(channels, "send_text", refused)
    ch = add(world, "whatsapp")
    res = apps.post(f"/internal/channels/{ch['id']}/send", json={"to": "91", "text": "hi"}, headers={"X-Internal-Key": "k"})
    assert res.status_code == 502 and "24 hours" in res.json()["detail"]


def test_owner_replies_count_as_the_business_in_the_ai_history():
    from app import llm
    contents = llm.build_contents("ok?", [("ctx", 1.0)], [("user", "hi"), ("agent", "Priya here"), ("assistant", "x")])
    assert [c.role for c in contents] == ["user", "model", "model", "user"]
