"""Unit tests: pure logic, no database, broker or embedding model."""
import json
import uuid

import pytest

from app import worker
from app.chunking import chunk_text
from app.parsing import extract_text, resolve_storage_path

pytestmark = pytest.mark.unit


# ---------- chunking ----------

def test_short_text_is_one_chunk():
    assert chunk_text("Open 9 to 5.") == ["Open 9 to 5."]


def test_empty_or_whitespace_gives_no_chunks():
    assert chunk_text("") == []
    assert chunk_text(" \n\n \t ") == []


def test_normalizes_whitespace_and_line_endings():
    assert chunk_text("a\r\nb\r\n\r\n\r\n\r\nc   d\t\te") == ["a\nb\n\nc d e"]


def test_long_text_is_split_with_overlap_and_size_limit():
    text = " ".join(f"word{i}" for i in range(2000))
    chunks = chunk_text(text, size=200, overlap=50)
    assert len(chunks) > 5
    assert all(len(c) <= 200 for c in chunks)
    # consecutive chunks share some text (the overlap)
    for a, b in zip(chunks, chunks[1:]):
        assert a.split()[-1] in b or b.split()[0] in a
    # nothing is lost
    words = set(" ".join(chunks).split())
    assert {f"word{i}" for i in range(2000)} <= words


def test_prefers_paragraph_boundaries():
    para = "x" * 150
    chunks = chunk_text(f"{para}\n\n{para}\n\n{para}", size=200, overlap=0)
    assert chunks[0] == para


def test_never_loops_forever_on_text_without_separators():
    chunks = chunk_text("a" * 5000, size=100, overlap=99)
    assert len(chunks) >= 50
    assert all(len(c) <= 100 for c in chunks)


# ---------- parsing ----------

def test_reads_txt_with_bom_and_md(storage):
    (storage / "a.txt").write_bytes("﻿Hello café".encode("utf-8"))
    (storage / "b.MD").write_text("# Title\nBody", encoding="utf-8")
    assert extract_text(storage / "a.txt") == "Hello café"
    assert extract_text(storage / "b.MD") == "# Title\nBody"


def test_reads_docx(storage):
    from docx import Document

    d = Document()
    d.add_paragraph("Opening hours")
    d.add_paragraph("Mon-Fri 9-5")
    d.save(storage / "x.docx")
    assert extract_text(storage / "x.docx") == "Opening hours\n\nMon-Fri 9-5"


def _minimal_pdf(text: str) -> bytes:
    content = f"BT /F1 24 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def test_reads_pdf(storage):
    (storage / "menu.pdf").write_bytes(_minimal_pdf("Sourdough costs 6 dollars"))
    assert "Sourdough costs 6 dollars" in extract_text(storage / "menu.pdf")


def test_unsupported_type_raises(storage):
    (storage / "x.exe").write_bytes(b"MZ")
    with pytest.raises(ValueError, match="Unsupported"):
        extract_text(storage / "x.exe")


def test_storage_path_stays_inside_root(storage):
    assert resolve_storage_path("t/b/d.txt") == storage / "t" / "b" / "d.txt"
    for evil in ("../outside.txt", "t/../../outside.txt", f"../{storage.name}-evil/x.txt"):
        with pytest.raises(ValueError):
            resolve_storage_path(evil)


# ---------- message handling (database and model replaced by fakes) ----------

class Recorder:
    def __init__(self):
        self.published = []

    def __call__(self, key, payload):
        self.published.append((key, payload))


class FakeConn:
    closed = False

    def __init__(self):
        self.rollbacks = 0

    def rollback(self):
        self.rollbacks += 1


def _upload_msg(**overrides):
    msg = {"documentId": str(uuid.uuid4()), "tenantId": str(uuid.uuid4()), "botId": str(uuid.uuid4()),
           "storageKey": "t/b/d.txt", "fileName": "d.txt"}
    msg.update(overrides)
    return msg


def test_upload_success_publishes_processed(monkeypatch):
    monkeypatch.setattr(worker, "process", lambda conn, msg: 4)
    pub = Recorder()
    msg = _upload_msg()
    worker.Handler(FakeConn(), pub).handle("document.uploaded", json.dumps(msg).encode())
    assert pub.published == [("document.processed", {
        "documentId": msg["documentId"], "tenantId": msg["tenantId"], "botId": msg["botId"], "chunkCount": 4})]


def test_upload_failure_publishes_failed_and_rolls_back(monkeypatch):
    def boom(conn, msg):
        raise ValueError("No text could be extracted from the document")

    monkeypatch.setattr(worker, "process", boom)
    pub, conn = Recorder(), FakeConn()
    msg = _upload_msg()
    worker.Handler(conn, pub).handle("document.uploaded", json.dumps(msg).encode())
    key, payload = pub.published[0]
    assert key == "document.failed"
    assert payload["documentId"] == msg["documentId"]
    assert "No text" in payload["error"]
    assert conn.rollbacks == 1


def test_error_message_is_truncated(monkeypatch):
    monkeypatch.setattr(worker, "process", lambda c, m: (_ for _ in ()).throw(RuntimeError("x" * 2000)))
    pub = Recorder()
    worker.Handler(FakeConn(), pub).handle("document.uploaded", json.dumps(_upload_msg()).encode())
    assert len(pub.published[0][1]["error"]) == 500


@pytest.mark.parametrize("body", [b"not json", b"[]", json.dumps({"botId": "x"}).encode()])
def test_garbage_messages_never_crash_or_publish_bogus_events(body):
    pub = Recorder()
    worker.Handler(FakeConn(), pub).handle("document.uploaded", body)
    assert pub.published == []


def test_delete_events_route_to_the_right_cleanup(monkeypatch):
    calls = []
    monkeypatch.setattr(worker.db, "delete_document_chunks", lambda c, t, d: calls.append(("doc", t, d)) or 2)
    monkeypatch.setattr(worker.db, "delete_bot_chunks", lambda c, t, b: calls.append(("bot", t, b)) or 5)
    pub = Recorder()
    h = worker.Handler(FakeConn(), pub)
    t, b, d = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    h.handle("document.deleted", json.dumps({"documentId": str(d), "tenantId": str(t), "botId": str(b)}).encode())
    h.handle("bot.deleted", json.dumps({"botId": str(b), "tenantId": str(t)}).encode())
    assert calls == [("doc", t, d), ("bot", t, b)]
    assert pub.published == []   # deletions are not reported back


def test_process_reports_missing_file(storage):
    with pytest.raises(FileNotFoundError):
        worker.process(None, _upload_msg(storageKey="t/b/missing.txt"))


def test_damaged_files_get_a_friendly_error(storage):
    from app.parsing import UnreadableDocumentError

    (storage / "broken.pdf").write_bytes(b"%PDF-1.4 this is not really a pdf")
    (storage / "broken.docx").write_bytes(b"PK not a zip")
    for name in ("broken.pdf", "broken.docx"):
        with pytest.raises(UnreadableDocumentError) as err:
            extract_text(storage / name)
        assert "could not be read" in str(err.value)
        assert "startxref" not in str(err.value) and "zip" not in str(err.value).lower()


def test_encrypted_pdf_is_reported_as_unreadable(storage):
    from pypdf import PdfReader, PdfWriter
    from app.parsing import UnreadableDocumentError

    (storage / "plain.pdf").write_bytes(_minimal_pdf("secret"))
    writer = PdfWriter()
    for page in PdfReader(str(storage / "plain.pdf")).pages:
        writer.add_page(page)
    writer.encrypt("pw")
    with open(storage / "locked.pdf", "wb") as f:
        writer.write(f)
    with pytest.raises(UnreadableDocumentError):
        extract_text(storage / "locked.pdf")
