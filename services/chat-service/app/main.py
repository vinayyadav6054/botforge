import asyncio
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field

from . import config
from .bots_client import consume_answer, create_lead, record_turn, refund_answer, resolve_bot
from .language import AUDIO_TYPES, MAX_AUDIO_BYTES, to_english, transcribe
from .llm import clean_actions, stream_answer
from .retrieval import citations, get_model, retrieve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("chat")

PUBLIC_KEY = re.compile(r"^bk_[0-9a-f]{32}$")
CONVERSATION_ID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

NO_INFORMATION = "I don't have any information to answer that yet."
# the system prompt tells the model to say this when the documents do not cover the question
_NO_INFO = re.compile(
    r"(don['’]t|do not|doesn['’]t|does not) (have|contain|include|mention)\b[^.!?]{0,40}\b(information|details)"
    r"|\bno (information|details) (about|on|regarding|for)\b"
    r"|\b(isn['’]t|is not|not) mentioned in\b",
    re.IGNORECASE)


def says_no_information(answer: str) -> bool:
    """True when the model said the documents do not answer the question (marked "unanswered" for the owner)."""
    return bool(_NO_INFO.search(answer))
LIMIT_REACHED = ("This assistant has reached its limit of answers for this month. "
                 "Please contact us directly and we will be happy to help.")
NOT_AVAILABLE = "This assistant is not available right now. Please contact us directly."


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading embedding model...")
    await asyncio.to_thread(get_model)
    log.info("Chat service ready (model: %s)", config.GEMINI_MODEL)
    yield


app = FastAPI(title="botforge chat-service", lifespan=lifespan)

# the widget runs on customers' websites, so any origin may call this public endpoint
# (later: restrict per bot to the domains the business registered)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=config.MAX_HISTORY_TURN_CHARS)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)
    # earlier turns of this conversation, oldest first; the widget keeps them (we store nothing)
    history: list[Turn] = Field(default_factory=list, max_length=config.MAX_HISTORY_TURNS)
    # the widget's id for this visitor session, so the owner sees the whole conversation together
    conversationId: str | None = Field(default=None, pattern=CONVERSATION_ID)
    pageUrl: str | None = Field(default=None, max_length=2000)
    # the dashboard's test playground: answers normally but is not stored as a visitor conversation
    playground: bool = False


class LeadRequest(BaseModel):
    name: str = Field(max_length=200)
    phone: str = Field(max_length=40)
    email: str | None = Field(default=None, max_length=300)
    course: str | None = Field(default=None, max_length=300)
    pageUrl: str | None = Field(default=None, max_length=2000)
    transcript: list[Turn] = Field(default_factory=list, max_length=config.MAX_HISTORY_TURNS)
    # honeypot: hidden in the widget, so only bots fill it in
    website: str | None = Field(default=None, max_length=500)


def retrieval_query(question: str, history: list[tuple[str, str]]) -> str:
    """Follow-ups like "and on Saturday?" only make sense with the previous question, so search with both."""
    previous = next((text for role, text in reversed(history) if role == "user"), None)
    return f"{previous}\n{question}" if previous else question


async def check_quota(public_key: str) -> str | None:
    """None when the plan allows another AI answer, otherwise the message to show instead."""
    try:
        ok, reason = await consume_answer(public_key)
    except httpx.HTTPError:
        log.warning("Usage check failed; answering anyway")
        return None
    return None if ok else (LIMIT_REACHED if reason == "limit" else NOT_AVAILABLE)


async def give_back(public_key: str) -> None:
    """The AI call failed after the answer was counted."""
    try:
        await refund_answer(public_key)
    except httpx.HTTPError:
        log.warning("Could not refund a failed answer")


async def find_chunks(bot: dict, question: str, history: list[tuple[str, str]]):
    """Searches with the question, plus its English translation when it is in Hindi, Hinglish, Tamil..."""
    query = retrieval_query(question, history)
    english = await to_english(question)
    if english:
        query = f"{query}\n{english}"
    return await asyncio.to_thread(retrieve, uuid.UUID(bot["tenantId"]), uuid.UUID(bot["botId"]), query, config.TOP_K)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health():
    return {"status": "ok", "service": "chat", "model": config.GEMINI_MODEL}


async def _get_bot(public_key: str) -> dict:
    if not PUBLIC_KEY.match(public_key):
        raise HTTPException(status_code=404, detail="Unknown bot")
    try:
        bot = await resolve_bot(public_key)
    except httpx.HTTPError:
        log.exception("Bot service unavailable")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")
    if bot is None:
        raise HTTPException(status_code=404, detail="Unknown bot")
    return bot


@app.get("/chat/{public_key}/info")
async def bot_info(public_key: str):
    """Public data the widget needs before the first message."""
    bot = await _get_bot(public_key)
    lead = bot.get("leadCapture") or {}
    look = bot.get("appearance") or {}
    hours = bot.get("hours") or {}
    timing = lead.get("timing") if lead.get("timing") in ("after", "start", "button") else "after"
    color = look.get("color")
    avatar = look.get("avatar")
    return {
        "name": bot["name"],
        "welcomeMessage": bot["welcomeMessage"],
        "leadCapture": {
            "enabled": bool(lead.get("enabled")),
            "prompt": lead.get("prompt") or "",
            "afterMessages": int(lead.get("afterMessages") or 0),
            "timing": timing,
            "askEmail": bool(lead.get("askEmail")),
            "askCourse": lead.get("askCourse", True) is not False,
            "courseLabel": str(lead.get("courseLabel") or "Course / interest")[:60],
        },
        "suggestedQuestions": _questions(bot.get("suggestedQuestions")),
        "branding": {"show": bot.get("showBranding", True) is not False, "url": config.BRANDING_URL},
        # defensive: only values the widget can use safely (the bot service validates them too)
        "appearance": {
            "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color) else None,
            "position": "left" if look.get("position") == "left" else "right",
            "avatar": avatar if isinstance(avatar, str) and re.fullmatch(
                r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}", avatar) else None,
        },
        "actions": clean_actions(bot.get("actions")),
        "language": (bot.get("style") or {}).get("replyLanguage") or "auto",
        "voice": bot.get("voiceEnabled") is not False,
        "hours": {
            "enabled": bool(hours.get("enabled")),
            "start": hours.get("start") or "09:00",
            "end": hours.get("end") or "18:00",
            "days": [d for d in hours.get("days") or [] if isinstance(d, int) and 1 <= d <= 7],
            "timeZone": hours.get("timeZone") or "Asia/Kolkata",
            "message": str(hours.get("message") or "")[:300],
        },
    }


def _questions(raw) -> list[str]:
    """Defensive copy of the owner's suggested questions: strings only, at most 4, each short."""
    if not isinstance(raw, list):
        return []
    return [q.strip()[:120] for q in raw if isinstance(q, str) and q.strip()][:4]


@app.post("/chat/{public_key}/lead")
async def submit_lead(public_key: str, body: LeadRequest):
    """A visitor left their details. Validation and storage happen in the bot service."""
    if not PUBLIC_KEY.match(public_key):
        raise HTTPException(status_code=404, detail="Unknown bot")
    if body.website:
        log.info("Lead honeypot triggered for a bot; dropped")
        return {"ok": True}  # look successful so spam bots learn nothing

    try:
        response = await create_lead(public_key, body.model_dump(exclude={"website"}))
    except httpx.HTTPError:
        log.exception("Bot service unavailable")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")

    if response.status_code in (200, 201):
        return {"ok": True}
    if response.status_code in (400, 409):
        try:
            error = response.json().get("error") or "Please check your details."
        except ValueError:
            error = "Please check your details."
        raise HTTPException(status_code=response.status_code, detail=error)
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Unknown bot")
    log.error("Unexpected status %s from bot service when saving a lead", response.status_code)
    raise HTTPException(status_code=503, detail="Service temporarily unavailable")


@app.post("/chat/{public_key}")
async def chat(public_key: str, body: ChatRequest):
    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message is empty")

    bot = await _get_bot(public_key)

    history = [(t.role, t.text) for t in body.history if t.text.strip()]
    chunks = await find_chunks(bot, question, history)

    conversation_id = body.conversationId or str(uuid.uuid4())

    async def record(answer: str, answered: bool):
        # best effort: the visitor's answer must never fail because the history could not be saved
        if body.playground:
            return
        try:
            await record_turn(public_key, {"conversationId": conversation_id, "question": question,
                                           "answer": answer, "answered": answered, "pageUrl": body.pageUrl})
        except httpx.HTTPError:
            log.warning("Could not store a conversation turn")

    async def allowed() -> str | None:
        return await check_quota(public_key)

    async def events():
        yield sse("meta", {"botName": bot["name"], "sources": len(chunks), "conversationId": conversation_id})
        if not chunks:
            yield sse("token", {"text": NO_INFORMATION})
            await record(NO_INFORMATION, answered=False)
            yield sse("done", {})
            return
        blocked = await allowed()
        if blocked:
            yield sse("token", {"text": blocked})
            yield sse("done", {})
            return
        answer = []
        try:
            async for token in stream_answer(bot["name"], question, chunks, history, style=bot.get("style"),
                                            actions=bot.get("actions")):
                answer.append(token)
                yield sse("token", {"text": token})
        except Exception as ex:
            # the reason on the same line: hosted log search shows only matching lines
            log.exception("Gemini call failed: %s: %s", type(ex).__name__, str(ex)[:500])
            await give_back(public_key)
            busy = getattr(ex, "code", None) in (429, 503)
            message = ("The assistant is busy right now. Please try again in a moment."
                       if busy else "Sorry, something went wrong. Please try again.")
            yield sse("error", {"message": message})
            return
        text = "".join(answer)
        answered = not says_no_information(text)
        await record(text, answered=answered)
        # where the answer came from: shown under it when the owner enables it (playground always gets them)
        if answered and (bot.get("showSources") or body.playground):
            sources = citations(chunks)
            if sources:
                yield sse("sources", {"items": sources})
        yield sse("done", {})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/chat/{public_key}/transcribe")
async def transcribe_voice(public_key: str, request: Request):
    """The widget's microphone: audio in, text out (the widget then sends it as a normal question)."""
    bot = await _get_bot(public_key)
    if bot.get("active") is False:
        raise HTTPException(status_code=403, detail="This assistant is not available right now.")
    mime = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if mime not in AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    audio = bytearray()
    async for part in request.stream():
        audio += part
        if len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="The recording is too long")
    if not audio:
        raise HTTPException(status_code=400, detail="Empty recording")
    try:
        text = await transcribe(bytes(audio), mime)
    except Exception as ex:
        log.exception("Transcription failed: %s: %s", type(ex).__name__, str(ex)[:500])
        raise HTTPException(status_code=503, detail="Could not understand the recording. Please type your question.")
    return {"text": text}


# messaging apps (WhatsApp, Instagram, Messenger, Telegram) post their webhooks here
from .channels import router as channels_router  # noqa: E402

app.include_router(channels_router)
