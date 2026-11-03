import os

from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


DATABASE_URL = _required("DATABASE_URL")
GEMINI_API_KEY = _required("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
BOTS_SERVICE_URL = os.getenv("BOTS_SERVICE_URL", "http://localhost:5215")
INTERNAL_API_KEY = _required("INTERNAL_API_KEY")

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
TOP_K = int(os.getenv("RETRIEVAL_TOP_K", "5"))
MAX_QUESTION_CHARS = 1000
MAX_HISTORY_TURNS = 10
MAX_HISTORY_TURN_CHARS = 4000
