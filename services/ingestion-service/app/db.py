import psycopg
from pgvector.psycopg import register_vector

from . import config


def connect() -> psycopg.Connection:
    conn = psycopg.connect(config.DATABASE_URL)
    register_vector(conn)
    return conn


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS knowledge")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS knowledge.chunks (
                id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id   uuid NOT NULL,
                bot_id      uuid NOT NULL,
                document_id uuid NOT NULL,
                chunk_index int  NOT NULL,
                content     text NOT NULL,
                embedding   vector({config.EMBEDDING_DIM}) NOT NULL,
                created_at  timestamptz NOT NULL DEFAULT now()
            )""")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_chunks_tenant_bot ON knowledge.chunks (tenant_id, bot_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_chunks_document ON knowledge.chunks (document_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_chunks_embedding ON knowledge.chunks USING hnsw (embedding vector_cosine_ops)")
    conn.commit()


def replace_chunks(conn, tenant_id, bot_id, document_id, chunks, vectors) -> None:
    rows = [
        (tenant_id, bot_id, document_id, i, content, vector)
        for i, (content, vector) in enumerate(zip(chunks, vectors))
    ]
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM knowledge.chunks WHERE document_id = %s AND tenant_id = %s",
            (document_id, tenant_id),
        )
        cur.executemany(
            """INSERT INTO knowledge.chunks
               (tenant_id, bot_id, document_id, chunk_index, content, embedding)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            rows,
        )
    conn.commit()
