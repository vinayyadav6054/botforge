import sys
import uuid

from . import db
from .embedder import embed


def main() -> None:
    if len(sys.argv) < 4:
        print('Usage: python -m app.search_test <tenant_id> <bot_id> "your question"')
        return
    tenant_id, bot_id = uuid.UUID(sys.argv[1]), uuid.UUID(sys.argv[2])
    question = " ".join(sys.argv[3:])

    conn = db.connect()
    vector = embed([question])[0]
    with conn.cursor() as cur:
        cur.execute(
            """SELECT chunk_index, 1 - (embedding <=> %s) AS score, content
               FROM knowledge.chunks
               WHERE tenant_id = %s AND bot_id = %s
               ORDER BY embedding <=> %s
               LIMIT 3""",
            (vector, tenant_id, bot_id, vector),
        )
        for index, score, content in cur.fetchall():
            print(f"[{score:.3f}] chunk {index}: {content[:120]!r}")


if __name__ == "__main__":
    main()
