import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


DATABASE_URL = _required("DATABASE_URL")
# either a full URL (amqps://user:pass@host/vhost, e.g. CloudAMQP) or host/port/user/password
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "").strip()
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "localhost")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "") if RABBITMQ_URL else _required("RABBITMQ_USER")
RABBITMQ_PASSWORD = os.getenv("RABBITMQ_PASSWORD", "") if RABBITMQ_URL else _required("RABBITMQ_PASSWORD")
EXCHANGE = os.getenv("RABBITMQ_EXCHANGE", "botforge.events")
QUEUE = os.getenv("INGESTION_QUEUE", "ingestion.documents")

STORAGE_ROOT = Path(_required("STORAGE_ROOT")).resolve()

# "local": fastembed model on this machine (~300 MB RAM); "gemini": Gemini embedding API (tiny RAM, needs a key).
# Pick one per database - vectors from different providers cannot be compared.
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local").strip().lower()
if EMBEDDING_PROVIDER not in ("local", "gemini", "model2vec"):
    raise RuntimeError("EMBEDDING_PROVIDER must be 'local', 'gemini' or 'model2vec'")
# model2vec: small static model (~60 MB RAM, numpy only, no API limits) - the free-host default
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or (
    "minishlab/potion-base-8M" if EMBEDDING_PROVIDER == "model2vec" else "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
# which model made a stored vector; stored chunks made by another model are re-embedded at start-up
EMBEDDING_ID = f"gemini:{GEMINI_EMBEDDING_MODEL}" if EMBEDDING_PROVIDER == "gemini" else f"{EMBEDDING_PROVIDER}:{EMBEDDING_MODEL}"
GEMINI_API_KEY = _required("GEMINI_API_KEY") if EMBEDDING_PROVIDER == "gemini" else os.getenv("GEMINI_API_KEY", "")
# set (e.g. http://127.0.0.1:8000): the chat service on the same machine makes the vectors with its copy of the
# model, so this process does not load one (saves ~70 MB on a small host). Both services need the same model settings.
EMBED_SERVICE_URL = os.getenv("EMBED_SERVICE_URL", "").strip().rstrip("/") if EMBEDDING_PROVIDER != "gemini" else ""
INTERNAL_API_KEY = _required("INTERNAL_API_KEY") if EMBED_SERVICE_URL else os.getenv("INTERNAL_API_KEY", "")

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))

# online sources may only fetch public internet addresses; "true" allows localhost/private ones (local testing only)
ALLOW_PRIVATE_SOURCES = os.getenv("ALLOW_PRIVATE_SOURCES", "").strip().lower() in ("1", "true", "yes")
