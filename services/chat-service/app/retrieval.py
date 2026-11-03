import uuid

import psycopg
from fastembed import TextEmbedding
from pgvector.psycopg import register_vector

from . import config

_model: TextEmbedding | None = None


def get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(model_name=config.EMBEDDING_MODEL)
    return _model


def retrieve(tenant_id: uuid.UUID, bot_id: uuid.UUID, question: str, top_k: int) -> list[tuple[str, float]]:
    vector = list(get_model().embed([question]))[0]
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
