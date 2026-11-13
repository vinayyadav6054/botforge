import re
import uuid
from typing import NamedTuple

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


class Retrieved(NamedTuple):
    """A knowledge chunk picked for the answer. Unpacks like the old (content, score) pairs via [0]/[1]."""
    content: str
    score: float
    source_name: str | None = None
    location: str | None = None
    url: str | None = None
    kind: str = "file"


# common words that would make every chunk match the keyword search
_STOP = set("""a an and are as at be by can do does for from have how i in is it me my of on or the this to was what
when where which who why will with you your hai kya ka ki ke ko se me hain aap""".split())
CANDIDATES = 20   # per search method, before fusing
RRF_K = 60        # reciprocal rank fusion constant (standard value)
QA_BONUS = 0.05   # an owner-written answer that is semantically close wins over document text


def keyword_query(question: str) -> str | None:
    """OR-query of the meaningful words (letters/digits only, so it is always a valid tsquery)."""
    words = [w for w in re.findall(r"\w+", question.lower()) if len(w) > 1 and w not in _STOP]
    unique = list(dict.fromkeys(words))[:12]
    return " | ".join(unique) if unique else None


def retrieve(tenant_id: uuid.UUID, bot_id: uuid.UUID, question: str, top_k: int) -> list[Retrieved]:
    """Hybrid search: vector similarity (meaning) and full-text (exact words such as codes, names, prices),
    merged with reciprocal rank fusion, so a chunk found by both ranks highest."""
    vector = embed_query(question)
    params = {"v": vector, "t": tenant_id, "b": bot_id, "q": keyword_query(question), "n": CANDIDATES,
              "k": RRF_K, "bonus": QA_BONUS, "top": top_k}
    with psycopg.connect(config.DATABASE_URL) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """WITH v AS (
                       SELECT id, row_number() OVER (ORDER BY embedding <=> %(v)s) AS r
                       FROM knowledge.chunks WHERE tenant_id = %(t)s AND bot_id = %(b)s
                       ORDER BY embedding <=> %(v)s LIMIT %(n)s),
                   k AS (
                       SELECT id, row_number() OVER (ORDER BY ts_rank(tsv, query) DESC) AS r
                       FROM knowledge.chunks, to_tsquery('simple', %(q)s) AS query
                       WHERE %(q)s IS NOT NULL AND tenant_id = %(t)s AND bot_id = %(b)s AND tsv @@ query
                       ORDER BY ts_rank(tsv, query) DESC LIMIT %(n)s)
                   SELECT c.content,
                          COALESCE(1.0 / (%(k)s + v.r), 0) + COALESCE(1.0 / (%(k)s + k.r), 0)
                            + CASE WHEN c.kind = 'qa' AND v.r <= 3 THEN %(bonus)s ELSE 0 END AS score,
                          c.source_name, c.location, c.source_url, c.kind
                   FROM knowledge.chunks c
                   LEFT JOIN v ON v.id = c.id
                   LEFT JOIN k ON k.id = c.id
                   WHERE v.id IS NOT NULL OR k.id IS NOT NULL
                   ORDER BY score DESC
                   LIMIT %(top)s""",
                params,
            )
            return [Retrieved(content, float(score), name, location, url, kind or "file")
                    for content, score, name, location, url, kind in cur.fetchall()]


def citations(chunks, limit: int = 2) -> list[dict]:
    """The distinct documents/pages behind the best chunks, for "Source: ..." under the answer.
    Owner Q&A entries are not shown as a source."""
    seen, out = set(), []
    for c in chunks:
        name = getattr(c, "source_name", None)
        if not name or getattr(c, "kind", "file") == "qa":
            continue
        key = (name, c.location, c.url)
        if key in seen:
            continue
        seen.add(key)
        out.append({"name": name, "location": c.location, "url": c.url})
        if len(out) == limit:
            break
    return out
