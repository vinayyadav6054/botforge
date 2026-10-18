from pathlib import Path

from docx import Document as DocxDocument
from pypdf import PdfReader

from . import config


def resolve_storage_path(key: str) -> Path:
    path = (config.STORAGE_ROOT / key).resolve()
    if config.STORAGE_ROOT not in path.parents:
        raise ValueError("Invalid storage key")
    return path


def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".txt", ".md"):
        return path.read_text(encoding="utf-8-sig", errors="replace")
    if ext == ".pdf":
        reader = PdfReader(str(path))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    if ext == ".docx":
        doc = DocxDocument(str(path))
        return "\n\n".join(p.text for p in doc.paragraphs)
    raise ValueError(f"Unsupported file type: {ext}")
