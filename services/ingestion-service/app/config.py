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
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "localhost")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = _required("RABBITMQ_USER")
RABBITMQ_PASSWORD = _required("RABBITMQ_PASSWORD")
EXCHANGE = os.getenv("RABBITMQ_EXCHANGE", "botforge.events")
QUEUE = os.getenv("INGESTION_QUEUE", "ingestion.documents")

STORAGE_ROOT = Path(_required("STORAGE_ROOT")).resolve()

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
