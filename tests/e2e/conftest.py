"""End-to-end tests against the running stack (./scripts/dev.ps1 start), only through the public gateway."""
import json
import os
import time
import uuid

import httpx
import pytest

GATEWAY = os.environ.get("BOTFORGE_GATEWAY", "http://localhost:5000").rstrip("/")
API = f"{GATEWAY}/api"


@pytest.fixture(scope="session", autouse=True)
def stack_is_running():
    try:
        httpx.get(f"{GATEWAY}/health", timeout=3).raise_for_status()
    except httpx.HTTPError as ex:
        pytest.exit(f"Gateway not reachable at {GATEWAY} - start the stack first ({ex})", returncode=2)


@pytest.fixture(scope="session")
def http():
    with httpx.Client(base_url=API, timeout=60) as c:
        yield c


class Tenant:
    def __init__(self, http: httpx.Client, name: str):
        self.http = http
        self.email = f"e2e-{uuid.uuid4().hex[:10]}@example.com"
        self.password = "E2e-Passw0rd!"
        res = http.post("/auth/register-tenant",
                        json={"tenantName": name, "email": self.email, "password": self.password})
        assert res.status_code == 200, res.text
        body = res.json()
        self.token = body["token"]
        self.tenant_id = body["tenantId"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def get(self, path, **kw):
        return self.http.get(path, headers=self.headers, **kw)

    def post(self, path, **kw):
        return self.http.post(path, headers=self.headers, **kw)

    def put(self, path, **kw):
        return self.http.put(path, headers=self.headers, **kw)

    def delete(self, path, **kw):
        return self.http.delete(path, headers=self.headers, **kw)

    def create_bot(self, name="E2E Bot", welcome="Hello from e2e!"):
        res = self.post("/bots", json={"name": name, "welcomeMessage": welcome})
        assert res.status_code == 201, res.text
        return res.json()

    def upload(self, bot_id, filename, content: bytes, content_type="text/plain"):
        res = self.post(f"/bots/{bot_id}/documents", files={"file": (filename, content, content_type)})
        assert res.status_code == 202, res.text
        return res.json()

    def wait_for_document(self, bot_id, doc_id, timeout=90):
        deadline = time.time() + timeout
        while time.time() < deadline:
            doc = self.get(f"/bots/{bot_id}/documents/{doc_id}").json()
            if doc["status"] in ("Ready", "Failed"):
                return doc
            time.sleep(1)
        raise AssertionError(f"document {doc_id} still {doc['status']} after {timeout}s")


@pytest.fixture
def tenant_factory(http):
    return lambda name="E2E Co": Tenant(http, name)


def chat(http: httpx.Client, public_key: str, message: str, history=None) -> dict:
    """Sends a chat message and collects the SSE stream into {meta, text, error, done}."""
    result = {"meta": None, "text": "", "error": None, "done": False}
    with http.stream("POST", f"/chat/{public_key}", json={"message": message, "history": history or []}) as res:
        assert res.status_code == 200, res.read()
        assert res.headers["content-type"].startswith("text/event-stream")
        event = None
        for line in res.iter_lines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "meta":
                    result["meta"] = data
                elif event == "token":
                    result["text"] += data["text"]
                elif event == "error":
                    result["error"] = data["message"]
                elif event == "done":
                    result["done"] = True
    return result
