import asyncio
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field

from . import config
from .bots_client import resolve_bot
from .llm import stream_answer
from .retrieval import get_model, retrieve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("chat")

PUBLIC_KEY = re.compile(r"^bk_[0-9a-f]{32}$")


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


def retrieval_query(question: str, history: list[tuple[str, str]]) -> str:
    """Follow-ups like "and on Saturday?" only make sense with the previous question, so search with both."""
    previous = next((text for role, text in reversed(history) if role == "user"), None)
    return f"{previous}\n{question}" if previous else question


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
    return {"name": bot["name"], "welcomeMessage": bot["welcomeMessage"]}


@app.post("/chat/{public_key}")
async def chat(public_key: str, body: ChatRequest):
    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message is empty")

    bot = await _get_bot(public_key)

    history = [(t.role, t.text) for t in body.history if t.text.strip()]
    chunks = await asyncio.to_thread(
        retrieve, uuid.UUID(bot["tenantId"]), uuid.UUID(bot["botId"]),
        retrieval_query(question, history), config.TOP_K
    )

    async def events():
        yield sse("meta", {"botName": bot["name"], "sources": len(chunks)})
        if not chunks:
            yield sse("token", {"text": "I don't have any information to answer that yet."})
            yield sse("done", {})
            return
        try:
            async for token in stream_answer(bot["name"], question, chunks, history):
                yield sse("token", {"text": token})
            yield sse("done", {})
        except Exception as ex:
            log.exception("Gemini call failed")
            busy = getattr(ex, "code", None) == 429
            message = ("The assistant is busy right now. Please try again in a moment."
                       if busy else "Sorry, something went wrong. Please try again.")
            yield sse("error", {"message": message})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
