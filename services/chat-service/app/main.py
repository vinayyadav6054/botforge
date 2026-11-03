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


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/health")
async def health():
    return {"status": "ok", "service": "chat", "model": config.GEMINI_MODEL}


@app.post("/chat/{public_key}")
async def chat(public_key: str, body: ChatRequest):
    if not PUBLIC_KEY.match(public_key):
        raise HTTPException(status_code=404, detail="Unknown bot")

    question = body.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message is empty")

    try:
        bot = await resolve_bot(public_key)
    except httpx.HTTPError:
        log.exception("Bot service unavailable")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")
    if bot is None:
        raise HTTPException(status_code=404, detail="Unknown bot")

    chunks = await asyncio.to_thread(
        retrieve, uuid.UUID(bot["tenantId"]), uuid.UUID(bot["botId"]), question, config.TOP_K
    )

    async def events():
        yield sse("meta", {"botName": bot["name"], "sources": len(chunks)})
        if not chunks:
            yield sse("token", {"text": "I don't have any information to answer that yet."})
            yield sse("done", {})
            return
        try:
            async for token in stream_answer(bot["name"], question, chunks):
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
