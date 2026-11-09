import uuid

import psycopg
from pgvector.psycopg import register_vector

from . import config, gemini_embed

_model = None


def get_model():
    """Loads the local model once (EMBEDDING_PROVIDER=local); nothing to load for Gemini."""
    global _model
    if config.EMBEDDING_PROVIDER == "gemini":
        return None
    if _model is None:
        from fastembed import TextEmbedding   # imported lazily: not installed on Gemini-only hosts
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def embed_query(text: str):
    if config.EMBEDDING_PROVIDER == "gemini":
        return gemini_embed.embed([text], "RETRIEVAL_QUERY")[0]
    return list(get_model().embed([text]))[0]


def embed_documents(texts: list[str]):
    """Same as the ingestion service stores them (used by tests and tools)."""
    if config.EMBEDDING_PROVIDER == "gemini":
        return gemini_embed.embed(texts, "RETRIEVAL_DOCUMENT")
    return list(get_model().embed(texts))


def retrieve(tenant_id: uuid.UUID, bot_id: uuid.UUID, question: str, top_k: int) -> list[tuple[str, float]]:
    vector = embed_query(question)
    with psycopg.connect(config.DATABASE_URL) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT content, 1 - (embedding <=> %s) AS score
                   FROM knowledge.chunks
                   WHERE tenant_id = %s AND bot_id = %s
                   ORDER BY embedding <=> %s
                   LIMIT %s""",
                (vector, tenant_id, bot_id, vector, top_k),
            )
            return [(content, float(score)) for content, score in cur.fetchall()]
