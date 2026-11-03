import os

import pytest
from dotenv import load_dotenv

load_dotenv()  # real settings first; the defaults below only fill gaps (e.g. on CI without .env)
os.environ.setdefault("DATABASE_URL", "host=localhost port=5432 dbname=botforge user=botforge password=unset")
os.environ.setdefault("GEMINI_API_KEY", "test-key")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

from app import config  # noqa: E402

TEST_DB = "botforge_test_chat"


@pytest.fixture(scope="session")
def test_database_url():
    """Recreates a throw-away database with the knowledge.chunks table the ingestion worker creates."""
    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    base = os.environ.get("BOTFORGE_TEST_DATABASE_URL") or config.DATABASE_URL
    params = conninfo_to_dict(base)
    try:
        with psycopg.connect(make_conninfo(**{**params, "dbname": "postgres"}), autocommit=True, connect_timeout=5) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
            c.execute(f'CREATE DATABASE "{TEST_DB}"')
    except psycopg.OperationalError as ex:
        pytest.skip(f"Postgres not reachable for integration tests: {ex}")

    url = make_conninfo(**{**params, "dbname": TEST_DB})
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS vector")
        c.execute("CREATE SCHEMA IF NOT EXISTS knowledge")
        c.execute("""CREATE TABLE knowledge.chunks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, bot_id uuid NOT NULL,
            document_id uuid NOT NULL, chunk_index int NOT NULL, content text NOT NULL,
            embedding vector(384) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())""")
    return url
