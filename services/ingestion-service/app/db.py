import psycopg
from pgvector.psycopg import register_vector

from . import config


def connect() -> psycopg.Connection:
    conn = psycopg.connect(config.DATABASE_URL)
    # managed databases (e.g. Neon) start without pgvector; the type must exist before register_vector
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.commit()
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
        # where an answer came from (shown to visitors) and what kind of knowledge it is ("file", "website", "qa", ...)
        cur.execute("ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS source_name text")
        cur.execute("ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS location text")
        cur.execute("ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS source_url text")
        cur.execute("ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file'")
        # keyword search next to the vector search ("simple": no language-specific stemming, works for Hinglish too)
        cur.execute("""ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS tsv tsvector
                       GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED""")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_chunks_tsv ON knowledge.chunks USING gin (tsv)")
        # which model made each vector (null: stored before this was tracked)
        cur.execute("ALTER TABLE knowledge.chunks ADD COLUMN IF NOT EXISTS embedding_model text")
    conn.commit()


def replace_chunks(conn, tenant_id, bot_id, document_id, chunks, vectors,
                   source_name: str | None = None, kind: str = "file") -> None:
    """chunks: plain strings or Chunk objects (with location/url)."""
    rows = [
        (tenant_id, bot_id, document_id, i, getattr(c, "content", c), vector, source_name,
         getattr(c, "location", None), getattr(c, "url", None), kind, config.EMBEDDING_ID)
        for i, (c, vector) in enumerate(zip(chunks, vectors))
    ]
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM knowledge.chunks WHERE document_id = %s AND tenant_id = %s",
            (document_id, tenant_id),
        )
        cur.executemany(
            """INSERT INTO knowledge.chunks
               (tenant_id, bot_id, document_id, chunk_index, content, embedding, source_name, location, source_url, kind,
                embedding_model)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            rows,
        )
    conn.commit()


def delete_document_chunks(conn, tenant_id, document_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM knowledge.chunks WHERE document_id = %s AND tenant_id = %s",
            (document_id, tenant_id),
        )
        count = cur.rowcount
    conn.commit()
    return count


def delete_bot_chunks(conn, tenant_id, bot_id) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM knowledge.chunks WHERE bot_id = %s AND tenant_id = %s",
            (bot_id, tenant_id),
        )
        count = cur.rowcount
    conn.commit()
    return count


def reembed_stale(conn, embed_fn, batch: int = 200, log=None) -> int:
    """Chunks stored by another embedding model cannot be searched with this one: re-embeds them from
    their stored text (no re-reading of files or websites). Runs at start-up; quick for a local model."""
    total = 0
    while True:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, content FROM knowledge.chunks
                           WHERE embedding_model IS DISTINCT FROM %s ORDER BY id LIMIT %s""",
                        (config.EMBEDDING_ID, batch))
            rows = cur.fetchall()
        if not rows:
            return total
        vectors = embed_fn([content for _, content in rows])
        with conn.cursor() as cur:
            cur.executemany("UPDATE knowledge.chunks SET embedding = %s, embedding_model = %s WHERE id = %s",
                            [(v, config.EMBEDDING_ID, i) for (i, _), v in zip(rows, vectors)])
        conn.commit()
        total += len(rows)
        if log:
            log.info("Re-embedded %d stored chunk(s) with %s", total, config.EMBEDDING_ID)
