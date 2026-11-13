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


# ---------- tables, spreadsheets and source locations ----------

from app.chunking import chunk_sections  # noqa: E402
from app.parsing import Section, extract_sections, rows_to_text  # noqa: E402


def test_table_rows_keep_their_column_names():
    rows = [["Course", "Fee", "Duration"], ["JEE", "68,000", "2 years"], ["NEET", "", "2 years"], ["", "", ""]]
    assert rows_to_text(rows) == "Course: JEE; Fee: 68,000; Duration: 2 years\nCourse: NEET; Duration: 2 years"


def test_tables_without_a_proper_header_are_kept_as_rows():
    assert rows_to_text([["Fees", ""], ["JEE", "68,000"]]) == "Fees\nJEE | 68,000"
    assert rows_to_text([]) == ""


def test_docx_tables_are_read_in_order(storage):
    from docx import Document

    d = Document()
    d.add_paragraph("Fee list")
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "Course", "Fee"
    t.cell(1, 0).text, t.cell(1, 1).text = "JEE", "68,000"
    d.add_paragraph("GST extra")
    d.save(storage / "fees.docx")
    assert extract_text(storage / "fees.docx") == "Fee list\n\nCourse: JEE; Fee: 68,000\n\nGST extra"


def test_reads_xlsx_sheets(storage):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Fees"
    ws.append(["Course", "Fee"])
    ws.append(["JEE", 68000])
    wb.create_sheet("Empty")
    wb.save(storage / "prices.xlsx")
    sections = extract_sections(storage / "prices.xlsx")
    assert [(s.location, s.text) for s in sections] == [("sheet Fees", "Fees\nCourse: JEE; Fee: 68000")]


def test_reads_csv_with_semicolons(storage):
    (storage / "menu.csv").write_text("Dish;Price\nDosa;120\n", encoding="utf-8")
    assert extract_text(storage / "menu.csv") == "Dish: Dosa; Price: 120"


def test_pdf_pages_become_locations(storage):
    (storage / "menu.pdf").write_bytes(_minimal_pdf("Sourdough costs 6 dollars"))
    assert extract_sections(storage / "menu.pdf")[0].location == "page 1"


def test_chunks_never_mix_sections():
    chunks = chunk_sections([Section("Page one text.", "page 1"), Section("Page two text.", "page 2", "https://x.example")])
    assert [(c.content, c.location, c.url) for c in chunks] == [
        ("Page one text.", "page 1", None), ("Page two text.", "page 2", "https://x.example")]


def test_qa_messages_are_routed(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, "upsert_qa", lambda conn, msg: calls.append(("up", msg["qaId"])))
    monkeypatch.setattr(worker.db, "delete_document_chunks", lambda conn, t, d: calls.append(("del", str(d))) or 1)
    h = worker.Handler(FakeConn(), Recorder())
    qa = {"qaId": str(uuid.uuid4()), "tenantId": str(uuid.uuid4()), "botId": str(uuid.uuid4()), "question": "Q", "answer": "A"}
    h.handle("qa.upserted", json.dumps(qa).encode())
    h.handle("qa.deleted", json.dumps(qa).encode())
    assert calls == [("up", qa["qaId"]), ("del", qa["qaId"])]
    assert h.publish.published == []   # Q&A never reports document status
