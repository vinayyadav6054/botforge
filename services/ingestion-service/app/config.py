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
if EMBEDDING_PROVIDER not in ("local", "gemini"):
    raise RuntimeError("EMBEDDING_PROVIDER must be 'local' or 'gemini'")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
GEMINI_API_KEY = _required("GEMINI_API_KEY") if EMBEDDING_PROVIDER == "gemini" else os.getenv("GEMINI_API_KEY", "")

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))

# online sources may only fetch public internet addresses; "true" allows localhost/private ones (local testing only)
ALLOW_PRIVATE_SOURCES = os.getenv("ALLOW_PRIVATE_SOURCES", "").strip().lower() in ("1", "true", "yes")
