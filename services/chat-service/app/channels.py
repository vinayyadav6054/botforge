"""Messaging apps: WhatsApp, Instagram, Facebook Messenger and Telegram send customer messages here (webhooks).
Each message is answered from the same knowledge as the website chat and the reply is sent back through the app.

Security: Telegram proves itself with the secret token we gave it; Meta signs every request with the app secret
(X-Hub-Signature-256). Requests without a valid proof are rejected before anything else happens.
"""
import asyncio
import hashlib
import hmac
import logging
import time
import uuid
from collections import OrderedDict

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import PlainTextResponse

from . import bots_client, config

log = logging.getLogger("chat")
router = APIRouter()

KINDS = ("whatsapp", "instagram", "messenger", "telegram")
CONVERSATION_NS = uuid.UUID("6f1c2a52-8b3e-4f0a-9d7c-1b2e3f405162")
MAX_REPLY = {"telegram": 4000, "whatsapp": 4000, "messenger": 1900, "instagram": 950}
PER_USER_PER_MINUTE = 20
UNSUPPORTED = "Sorry, I can read text and voice messages only."

_http = httpx.AsyncClient(timeout=20.0)
_seen: OrderedDict[str, None] = OrderedDict()          # platforms retry webhooks: answer each message once
_recent: dict[str, list[float]] = {}                    # per-customer flood protection


class Incoming:
    def __init__(self, user_id: str, name: str | None, message_id: str, text: str | None = None,
                 audio: dict | None = None, command: str | None = None):
        self.user_id, self.name, self.message_id = user_id, name, message_id
        self.text, self.audio, self.command = text, audio, command


def conversation_id(channel_id: str, user_id: str) -> str:
    """The same customer in the same app always continues one conversation."""
    return str(uuid.uuid5(CONVERSATION_NS, f"{channel_id}:{user_id}"))


def first_time(key: str) -> bool:
    if key in _seen:
        return False
    _seen[key] = None
    while len(_seen) > 5000:
        _seen.popitem(last=False)
    return True


def flooding(key: str, now: float | None = None) -> bool:
    now = now or time.monotonic()
    hits = [t for t in _recent.get(key, []) if now - t < 60] + [now]
    _recent[key] = hits
    return len(hits) > PER_USER_PER_MINUTE


def valid_meta_signature(body: bytes, header: str | None, app_secret: str) -> bool:
    if not header or not header.startswith("sha256=") or not app_secret:
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


# ---------- parsing each platform's webhook ----------

def parse_telegram(update: dict) -> list[Incoming]:
    msg = update.get("message") or {}
    sender, chat = msg.get("from") or {}, msg.get("chat") or {}
    if not chat.get("id") or sender.get("is_bot"):
        return []
    name = " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x) or sender.get("username")
    text = (msg.get("text") or msg.get("caption") or "").strip() or None
    command = text.split()[0].split("@")[0].lower() if text and text.startswith("/") else None
    audio = None
    if msg.get("voice") or msg.get("audio"):
        a = msg.get("voice") or msg.get("audio")
        audio = {"file_id": a.get("file_id"), "mime": (a.get("mime_type") or "audio/ogg").split(";")[0]}
    return [Incoming(str(chat["id"]), name, f"tg:{chat['id']}:{msg.get('message_id')}", None if command else text, audio, command)]


def parse_whatsapp(payload: dict, phone_number_id: str) -> list[Incoming]:
    out = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            if (value.get("metadata") or {}).get("phone_number_id") != phone_number_id:
                continue   # a message for another number of the same business account
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in value.get("contacts") or []}
            for m in value.get("messages") or []:
                kind, sender = m.get("type"), m.get("from")
                if not sender:
                    continue
                text = (m.get("text") or {}).get("body") if kind == "text" else None
                if kind == "button":
                    text = (m.get("button") or {}).get("text")
                audio = {"media_id": m["audio"].get("id"), "mime": (m["audio"].get("mime_type") or "audio/ogg").split(";")[0]} \
                    if kind == "audio" and m.get("audio") else None
                out.append(Incoming(sender, names.get(sender), f"wa:{m.get('id')}", (text or "").strip() or None, audio))
    return out


def parse_meta_messaging(payload: dict, own_id: str) -> list[Incoming]:
    """Messenger (object "page") and Instagram (object "instagram") use the same messaging format."""
    out = []
    for entry in payload.get("entry") or []:
        for event in entry.get("messaging") or []:
            msg = event.get("message") or {}
            sender = (event.get("sender") or {}).get("id")
            if not msg or msg.get("is_echo") or not sender or sender == own_id:
                continue   # our own replies come back as echoes
            audio = None
            for att in msg.get("attachments") or []:
                if att.get("type") == "audio" and (att.get("payload") or {}).get("url"):
                    audio = {"url": att["payload"]["url"], "mime": "audio/mp4"}
            text = (msg.get("text") or "").strip() or None
            out.append(Incoming(sender, None, f"meta:{msg.get('mid')}", text, audio))
    return out


# ---------- talking back to the platforms ----------

def _tg(path: str, token: str) -> str:
    return f"{config.TELEGRAM_API}/bot{token}/{path}"


async def send_text(channel: dict, user_id: str, text: str) -> None:
    secrets, kind = channel["secrets"], channel["kind"]
    limit = MAX_REPLY[kind]
    parts = [text[i:i + limit] for i in range(0, len(text), limit)] or [""]
    for part in parts:
        if kind == "telegram":
            res = await _http.post(_tg("sendMessage", secrets["token"]), json={"chat_id": user_id, "text": part})
        elif kind == "whatsapp":
            res = await _http.post(f"{config.GRAPH_API}/{secrets['phoneNumberId']}/messages",
                                   headers={"Authorization": f"Bearer {secrets['accessToken']}"},
                                   json={"messaging_product": "whatsapp", "to": user_id, "type": "text",
                                         "text": {"body": part, "preview_url": False}})
        else:
            res = await _http.post(f"{config.GRAPH_API}/me/messages", params={"access_token": secrets["pageToken"]},
                                   json={"recipient": {"id": user_id}, "messaging_type": "RESPONSE", "message": {"text": part}})
        if res.status_code >= 400:
            raise RuntimeError(f"{kind} refused the reply ({res.status_code}): {res.text[:200]}")


async def show_typing(channel: dict, user_id: str) -> None:
    try:
        if channel["kind"] == "telegram":
            await _http.post(_tg("sendChatAction", channel["secrets"]["token"]), json={"chat_id": user_id, "action": "typing"})
    except httpx.HTTPError:
        pass


async def download_audio(channel: dict, audio: dict) -> tuple[bytes, str]:
    secrets = channel["secrets"]
    if channel["kind"] == "telegram":
        info = (await _http.get(_tg("getFile", secrets["token"]), params={"file_id": audio["file_id"]})).json()
        path = info["result"]["file_path"]
        res = await _http.get(f"{config.TELEGRAM_API}/file/bot{secrets['token']}/{path}")
    elif channel["kind"] == "whatsapp":
        auth = {"Authorization": f"Bearer {secrets['accessToken']}"}
        meta = (await _http.get(f"{config.GRAPH_API}/{audio['media_id']}", headers=auth)).json()
        res = await _http.get(meta["url"], headers=auth)
    else:
        res = await _http.get(audio["url"])
    res.raise_for_status()
    if len(res.content) > 3 * 1024 * 1024:
        raise ValueError("voice message too long")
    return res.content, audio.get("mime") or "audio/ogg"


# ---------- answering ----------

def with_sources(text: str, sources: list[dict]) -> str:
    if not sources:
        return text
    names = " · ".join(f"{s['name']} ({s['location']})" if s.get("location") else s["name"] for s in sources)
    return f"{text}\n\n📄 Source: {names}"


async def answer(bot: dict, public_key: str, question: str, history: list[tuple[str, str]]) -> tuple[str, bool]:
    """(reply, answered) — the same pipeline as the website chat, without streaming."""
    from . import main as core
    from .retrieval import citations

    if bot.get("active") is False:
        return core.NOT_AVAILABLE, False
    chunks = await core.find_chunks(bot, question, history)
    if not chunks:
        return core.NO_INFORMATION, False
    blocked = await core.check_quota(public_key)
    if blocked:
        return blocked, False
    try:
        tokens = [t async for t in core.stream_answer(bot["name"], question, chunks, history, style=bot.get("style"))]
    except Exception:
        log.exception("Gemini call failed (messaging app)")
        await core.give_back(public_key)
        return "Sorry, I could not answer right now. Please try again in a moment.", False
    text = "".join(tokens).strip()
    answered = not core.says_no_information(text)
    if answered and bot.get("showSources"):
        text = with_sources(text, citations(chunks))
    return text, answered


async def handle(channel: dict, msg: Incoming) -> None:
    from . import main as core

    kind, cid = channel["kind"], conversation_id(channel["id"], msg.user_id)
    error = None
    try:
        if flooding(f"{channel['id']}:{msg.user_id}"):
            return
        bot = await bots_client.resolve_bot(channel["botPublicKey"])
        if bot is None:
            return
        if msg.command in ("/start", "/help"):
            questions = core._questions(bot.get("suggestedQuestions"))
            hint = ("\n\nYou can ask, for example:\n" + "\n".join(f"• {q}" for q in questions)) if questions else ""
            await send_text(channel, msg.user_id, f"{bot['welcomeMessage']}{hint}")
            return
        question = msg.text
        if not question and msg.audio:
            await show_typing(channel, msg.user_id)
            audio, mime = await download_audio(channel, msg.audio)
            question = await core.transcribe(audio, mime)
        if not question:
            await send_text(channel, msg.user_id, UNSUPPORTED)
            return
        question = question[: config.MAX_QUESTION_CHARS]

        await show_typing(channel, msg.user_id)
        history = [(t["role"], t["text"]) for t in await bots_client.recent_turns(cid, 10)]
        reply, answered = await answer(bot, channel["botPublicKey"], question, history)
        await send_text(channel, msg.user_id, reply)

        await bots_client.record_turn(channel["botPublicKey"], {
            "conversationId": cid, "question": question, "answer": reply, "answered": answered,
            "channel": kind, "contactName": msg.name, "contactId": msg.user_id})
        # on WhatsApp we know the customer's number: the first message makes them a lead
        lead = bot.get("leadCapture") or {}
        if kind == "whatsapp" and not history and lead.get("enabled"):
            await bots_client.create_lead(channel["botPublicKey"], {
                "name": (msg.name or "WhatsApp customer")[:100], "phone": f"+{msg.user_id}", "channel": "whatsapp",
                "transcript": [{"role": "user", "text": question}, {"role": "assistant", "text": reply[:4000]}]})
    except Exception as ex:
        error = str(ex)[:300]
        log.exception("Could not answer a %s message", kind)
    finally:
        try:
            await bots_client.channel_status(channel["id"], error)
        except httpx.HTTPError:
            pass


# ---------- webhook endpoints (public, through the gateway at /api/channels/...) ----------

async def _channel(kind: str, channel_id: str) -> dict:
    if kind not in KINDS:
        raise HTTPException(status_code=404)
    try:
        uuid.UUID(channel_id)
        channel = await bots_client.get_channel(channel_id)
    except ValueError:
        raise HTTPException(status_code=404)
    except httpx.HTTPError:
        raise HTTPException(status_code=503)
    if channel is None or channel["kind"] != kind:
        raise HTTPException(status_code=404)
    return channel


@router.get("/channels/{kind}/{channel_id}", response_class=PlainTextResponse)
async def verify_meta_webhook(kind: str, channel_id: str, request: Request):
    """Meta calls this once when the owner saves the webhook in their app (hub.challenge handshake)."""
    channel = await _channel(kind, channel_id)
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and hmac.compare_digest(q.get("hub.verify_token", ""), channel["verifyToken"]):
        return q.get("hub.challenge", "")
    raise HTTPException(status_code=403)


@router.post("/channels/{kind}/{channel_id}")
async def receive(kind: str, channel_id: str, request: Request, background: BackgroundTasks):
    channel = await _channel(kind, channel_id)
    body = await request.body()
    if kind == "telegram":
        if not hmac.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", ""), channel["webhookSecret"]):
            raise HTTPException(status_code=401)
    elif not valid_meta_signature(body, request.headers.get("x-hub-signature-256"), channel["secrets"].get("appSecret", "")):
        raise HTTPException(status_code=401)

    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(status_code=400)
    if kind == "telegram":
        messages = parse_telegram(payload)
    elif kind == "whatsapp":
        messages = parse_whatsapp(payload, channel["externalId"])
    else:
        messages = parse_meta_messaging(payload, channel["externalId"])

    for msg in messages:
        if first_time(msg.message_id):
            background.add_task(handle, channel, msg)   # answer after replying 200: platforms expect a fast response
    return {"ok": True}
