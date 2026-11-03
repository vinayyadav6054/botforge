import os
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv()  # real settings first; the defaults below only fill gaps (e.g. on CI without .env)
# config.py requires these at import time; real values come from .env when present
os.environ.setdefault("DATABASE_URL", "host=localhost port=5432 dbname=botforge user=botforge password=unset")
os.environ.setdefault("RABBITMQ_USER", "botforge")
os.environ.setdefault("RABBITMQ_PASSWORD", "unset")
os.environ.setdefault("STORAGE_ROOT", os.path.join(os.path.dirname(__file__), "..", "..", "..", "storage"))

from app import config  # noqa: E402

TEST_DB = "botforge_test_ingestion"


@pytest.fixture
def storage(tmp_path, monkeypatch):
    """A private storage root for the test."""
    root = tmp_path.resolve()
    monkeypatch.setattr(config, "STORAGE_ROOT", root)
    return root


@pytest.fixture(scope="session")
def test_database_url():
    """Recreates a throw-away database next to the dev one (same server and credentials)."""
    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    base = os.environ.get("BOTFORGE_TEST_DATABASE_URL") or config.DATABASE_URL
    params = conninfo_to_dict(base)
    admin = make_conninfo(**{**params, "dbname": "postgres"})
    try:
        with psycopg.connect(admin, autocommit=True, connect_timeout=5) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
            conn.execute(f'CREATE DATABASE "{TEST_DB}"')
        url = make_conninfo(**{**params, "dbname": TEST_DB})
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except psycopg.OperationalError as ex:
        pytest.skip(f"Postgres not reachable for integration tests: {ex}")
    return url


@pytest.fixture
def db_conn(test_database_url, monkeypatch):
    from app import db

    monkeypatch.setattr(config, "DATABASE_URL", test_database_url)
    conn = db.connect()
    db.ensure_schema(conn)
    yield conn
    conn.close()


@pytest.fixture
def ids():
    return {"tenant": uuid.uuid4(), "bot": uuid.uuid4(), "doc": uuid.uuid4()}
