import csv
import io
from dataclasses import dataclass
from pathlib import Path

from docx import Document as DocxDocument
from pypdf import PdfReader

from . import config

SUPPORTED = (".txt", ".md", ".pdf", ".docx", ".xlsx", ".csv")
MAX_TABLE_ROWS = 5000


@dataclass
class Section:
    """A part of a source that answers can point to: a PDF page, a sheet, a web page."""
    text: str
    location: str | None = None   # "page 3", "sheet Fees", a page title
    url: str | None = None        # for web pages and other online sources


def resolve_storage_path(key: str) -> Path:
    path = (config.STORAGE_ROOT / key).resolve()
    if config.STORAGE_ROOT not in path.parents:
        raise ValueError("Invalid storage key")
    return path


class UnreadableDocumentError(ValueError):
    """Shown to the business owner in the dashboard, so it must not contain parser internals."""


def extract_sections(path: Path) -> list[Section]:
    ext = path.suffix.lower()
    if ext not in SUPPORTED:
        raise ValueError(f"Unsupported file type: {ext}")
    try:
        return _extract(path, ext)
    except Exception as ex:
        raise UnreadableDocumentError(
            "The file could not be read. It may be damaged, password-protected or not a real "
            f"{ext.lstrip('.').upper()} file."
        ) from ex


def extract_text(path: Path) -> str:
    return "\n\n".join(s.text for s in extract_sections(path) if s.text)


def _extract(path: Path, ext: str) -> list[Section]:
    if ext in (".txt", ".md"):
        return [Section(path.read_text(encoding="utf-8-sig", errors="replace"))]
    if ext == ".pdf":
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise ValueError("encrypted PDF")
        return [Section(page.extract_text() or "", f"page {i}") for i, page in enumerate(reader.pages, 1)]
    if ext == ".docx":
        return [Section(_docx_text(DocxDocument(str(path))))]
    if ext == ".xlsx":
        return _xlsx_sections(path)
    if ext == ".csv":
        raw = path.read_bytes().decode("utf-8-sig", errors="replace")
        return [Section(rows_to_text(_csv_rows(raw)))]
    raise ValueError(f"Unsupported file type: {ext}")


def _docx_text(doc) -> str:
    """Paragraphs and tables in document order; every table row keeps its column names."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    parts: list[str] = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            parts.append(Paragraph(child, doc).text)
        elif tag == "tbl":
            rows = []
            for row in Table(child, doc).rows:
                cells, previous = [], None
                for cell in row.cells:
                    text = cell.text.strip()
                    if cell._tc is not previous:   # merged cells repeat the same cell object
                        cells.append(text)
                    previous = cell._tc
                rows.append(cells)
            parts.append(rows_to_text(rows))
    return "\n\n".join(parts)


def rows_to_text(rows: list[list[str]]) -> str:
    """A table as one line per row, "Column: value; Column: value", so each row is understandable alone
    (a price list row still says which course and which fee it is after the text is cut into chunks)."""
    rows = [[(c or "").strip() for c in r] for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        return ""
    header, body = rows[0], rows[1:MAX_TABLE_ROWS + 1]
    if not body or not all(header):
        return "\n".join(" | ".join(c for c in r if c) for r in rows[:MAX_TABLE_ROWS])
    lines = []
    for r in body:
        pairs = [f"{h}: {v}" for h, v in zip(header, r) if v]
        if pairs:
            lines.append("; ".join(pairs))
    return "\n".join(lines)


def _csv_rows(raw: str) -> list[list[str]]:
    try:
        dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return [row for _, row in zip(range(MAX_TABLE_ROWS + 1), csv.reader(io.StringIO(raw), dialect))]


def _xlsx_sections(path: Path) -> list[Section]:
    from openpyxl import load_workbook

    book = load_workbook(str(path), read_only=True, data_only=True)
    try:
        sections = []
        for sheet in book.worksheets:
            rows = []
            for values in sheet.iter_rows(values_only=True):
                rows.append(["" if v is None else str(v) for v in values])
                if len(rows) > MAX_TABLE_ROWS:
                    break
            text = rows_to_text(rows)
            if text:
                sections.append(Section(f"{sheet.title}\n{text}", f"sheet {sheet.title}"))
        return sections
    finally:
        book.close()
