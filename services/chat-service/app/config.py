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
# tried in order when the main model stays overloaded/rate-limited after its retries
GEMINI_FALLBACK_MODELS = [m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "").split(",") if m.strip()]
BOTS_SERVICE_URL = os.getenv("BOTS_SERVICE_URL", "http://localhost:5215")
INTERNAL_API_KEY = _required("INTERNAL_API_KEY")

# must match the ingestion service: "local" (fastembed) or "gemini" (Gemini embedding API)
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "local").strip().lower()
if EMBEDDING_PROVIDER not in ("local", "gemini"):
    raise RuntimeError("EMBEDDING_PROVIDER must be 'local' or 'gemini'")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
GEMINI_EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
TOP_K = int(os.getenv("RETRIEVAL_TOP_K", "5"))
MAX_QUESTION_CHARS = 1000
MAX_HISTORY_TURNS = 10
MAX_HISTORY_TURN_CHARS = 4000

# "Powered by BotForge" link in the widget (shown on plans that keep the badge); empty = text without a link
BRANDING_URL = os.getenv("BRANDING_URL", "").strip()

# messaging apps (overridable for tests)
TELEGRAM_API = os.getenv("TELEGRAM_API", "https://api.telegram.org").rstrip("/")
GRAPH_API = os.getenv("GRAPH_API", "https://graph.facebook.com/v21.0").rstrip("/")
