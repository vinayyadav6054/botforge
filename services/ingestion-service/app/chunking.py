import re
from dataclasses import dataclass


@dataclass
class Chunk:
    content: str
    location: str | None = None
    url: str | None = None


def chunk_text(text: str, size: int = 800, overlap: int = 100) -> list[str]:
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    chunks: list[str] = []
    start, n = 0, len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            # prefer to cut at a paragraph, sentence, line or word boundary
            window_start = start + int(size * 0.6)
            for sep in ("\n\n", ". ", "\n", " "):
                idx = text.rfind(sep, window_start, end)
                if idx != -1:
                    end = idx + len(sep)
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def chunk_sections(sections, size: int = 800, overlap: int = 100) -> list[Chunk]:
    """Chunks every section on its own, so a chunk never mixes two pages and keeps its page/URL."""
    return [Chunk(piece, s.location, s.url) for s in sections for piece in chunk_text(s.text, size, overlap)]
