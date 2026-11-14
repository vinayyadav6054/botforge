"""Online knowledge sources: a website crawl, Google Docs/Sheets/Slides/Drive links, Notion pages, YouTube captions.

Everything here fetches addresses typed in by business owners, so every request (and every redirect) is checked to
go to a public internet address: never localhost, the private network or cloud metadata endpoints (SSRF).
Errors raised as SourceError are shown to the owner in the dashboard.
"""
import ipaddress
import logging
import re
import socket
import tempfile
import time
from pathlib import Path
from urllib import robotparser
from urllib.parse import parse_qs, urldefrag, urljoin, urlparse

import httpx

from . import config
from .parsing import Section, extract_sections, rows_to_text, _csv_rows

log = logging.getLogger("ingestion")

USER_AGENT = "KahiyeBot/1.0 (reads the site for its owner's AI assistant)"
TIMEOUT = 15.0
MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
CRAWL_SECONDS = 240          # total time for one website crawl
CRAWL_DELAY = 0.2            # between requests to the same site
SKIP_EXTENSIONS = re.compile(r"\.(jpe?g|png|gif|webp|svg|ico|css|js|zip|rar|7z|mp4|mp3|avi|mov|woff2?|ttf|xml|json|exe|dmg|apk)$", re.I)


class SourceError(ValueError):
    """A problem the owner can fix; the message is shown in the dashboard."""


# ---------- safe fetching ----------

def _resolve(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


def check_public(url: str) -> None:
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise SourceError("Only http and https addresses can be used.")
    if getattr(config, "ALLOW_PRIVATE_SOURCES", False):
        return
    try:
        addresses = _resolve(parts.hostname)
    except socket.gaierror:
        raise SourceError(f"The address {parts.hostname} could not be found. Check the spelling.")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if not ip.is_global:
            raise SourceError("This address is not reachable from the internet.")


def fetch(client: httpx.Client, url: str, headers: dict | None = None) -> httpx.Response:
    """GET with redirects followed by hand, so each hop is checked; the body is capped at MAX_BYTES."""
    for _ in range(MAX_REDIRECTS + 1):
        check_public(url)
        with client.stream("GET", url, headers=headers) as res:
            if res.is_redirect and res.headers.get("location"):
                url = urljoin(str(res.url), res.headers["location"])
                continue
            body = bytearray()
            for chunk in res.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    raise SourceError("A page or file is larger than 5 MB.")
            # iter_bytes() already undid gzip/brotli: drop the encoding headers or the copy would be decoded twice
            headers = [(k, v) for k, v in res.headers.items() if k.lower() not in ("content-encoding", "content-length")]
            return httpx.Response(res.status_code, headers=headers, content=bytes(body), request=res.request)
    raise SourceError("The address redirects too many times.")


def new_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT})


# ---------- websites ----------

def html_to_section(url: str, html: str) -> tuple[Section | None, list[str]]:
    """Readable text of a page (without menus, scripts, footers) and the links on it."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        link = urldefrag(urljoin(url, a["href"].strip()))[0]
        if link.startswith(("http://", "https://")):
            links.append(link)
    title = (soup.title.get_text(" ", strip=True) if soup.title else "")[:120]
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "aside", "template"]):
        tag.decompose()
    for table in soup.find_all("table"):
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])] for tr in table.find_all("tr")]
        table.replace_with(soup.new_string("\n" + rows_to_text(rows) + "\n"))
    main = soup.find("main") or soup.find("article") or soup.body or soup
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in main.get_text("\n").splitlines()]
    text = "\n".join(line for line in lines if line)
    if len(text) < 40:
        return None, links
    return Section(f"{title}\n{text}" if title else text, title or urlparse(url).path or "/", url), links


def _same_site(a: str, b: str) -> bool:
    host = lambda u: (urlparse(u).hostname or "").removeprefix("www.")
    return host(a) == host(b)


def crawl(start_url: str, max_pages: int, client: httpx.Client | None = None) -> list[Section]:
    """Breadth-first crawl of one site, respecting robots.txt; starts from the sitemap when there is one."""
    client = client or new_client()
    max_pages = max(1, min(max_pages or 30, 500))
    started = time.monotonic()
    robots = robotparser.RobotFileParser()
    try:
        res = fetch(client, urljoin(start_url, "/robots.txt"))
        robots.parse(res.text.splitlines() if res.status_code == 200 else [])
    except (httpx.HTTPError, SourceError):
        robots.parse([])

    queue = [start_url] + _sitemap_urls(client, start_url, max_pages * 2)
    seen, sections, pages = set(), [], 0
    while queue and pages < max_pages and time.monotonic() - started < CRAWL_SECONDS:
        url = queue.pop(0)
        if url in seen or not _same_site(url, start_url) or SKIP_EXTENSIONS.search(urlparse(url).path):
            continue
        seen.add(url)
        if not robots.can_fetch(USER_AGENT, url):
            continue
        try:
            res = fetch(client, url)
        except SourceError as ex:
            if url == start_url:
                raise
            log.info("Skipping %s: %s", url, ex)
            continue
        except httpx.HTTPError as ex:
            if url == start_url:
                raise SourceError(f"The website could not be reached ({type(ex).__name__}).")
            continue
        if res.status_code != 200:
            if url == start_url and not sections:
                raise SourceError(f"The website answered with error {res.status_code}.")
            continue
        kind = res.headers.get("content-type", "").lower()
        if "html" in kind:
            pages += 1
            section, links = html_to_section(str(res.url), res.text)
            if section:
                sections.append(section)
            queue.extend(link for link in links if link not in seen)
        elif "pdf" in kind and pages < max_pages:
            pages += 1
            sections.extend(_file_sections(res.content, ".pdf", str(res.url)))
        time.sleep(CRAWL_DELAY)
    if not sections:
        raise SourceError("No readable text was found on this website. It may need JavaScript to show its content; "
                          "upload the information as a file instead.")
    return sections


def _sitemap_urls(client: httpx.Client, start_url: str, limit: int) -> list[str]:
    try:
        res = fetch(client, urljoin(start_url, "/sitemap.xml"))
    except (httpx.HTTPError, SourceError):
        return []
    if res.status_code != 200:
        return []
    urls = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", res.text)
    return [u for u in urls if _same_site(u, start_url) and not u.endswith(".xml")][:limit]


def _file_sections(content: bytes, ext: str, url: str) -> list[Section]:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"file{ext}"
        path.write_bytes(content)
        sections = extract_sections(path)
    for s in sections:
        s.url = url
    return sections


# ---------- Google Docs, Sheets, Slides, Drive (links shared as "Anyone with the link") ----------

def google_export_url(url: str) -> tuple[str, str]:
    """(download address, file type) for a shared Google link."""
    m = re.match(r"https://docs\.google\.com/(document|spreadsheets|presentation)/d/([A-Za-z0-9_-]+)", url)
    if m:
        kind, file_id = m.groups()
        if kind == "document":
            return f"https://docs.google.com/document/d/{file_id}/export?format=txt", ".txt"
        if kind == "presentation":
            return f"https://docs.google.com/presentation/d/{file_id}/export/txt", ".txt"
        gid = re.search(r"[#?&]gid=(\d+)", url)
        return (f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv"
                + (f"&gid={gid.group(1)}" if gid else "")), ".csv"
    m = re.match(r"https://drive\.google\.com/(?:file/d/([A-Za-z0-9_-]+)|open\?id=([A-Za-z0-9_-]+))", url)
    if m:
        file_id = m.group(1) or m.group(2)
        return f"https://drive.google.com/uc?export=download&id={file_id}", ""
    raise SourceError("This is not a Google Docs, Sheets, Slides or Drive link.")


def google(url: str, client: httpx.Client | None = None) -> list[Section]:
    client = client or new_client()
    export, ext = google_export_url(url)
    res = fetch(client, export)
    kind = res.headers.get("content-type", "").lower()
    if res.status_code in (401, 403, 404) or "text/html" in kind:
        raise SourceError("Google did not share this file. Set sharing to \"Anyone with the link can view\" and sync again.")
    if res.status_code != 200:
        raise SourceError(f"Google answered with error {res.status_code}.")
    if ext == ".csv":
        return [Section(rows_to_text(_csv_rows(res.content.decode("utf-8-sig", errors="replace"))), None, url)]
    if ext == ".txt":
        return [Section(res.content.decode("utf-8-sig", errors="replace"), None, url)]
    # a Drive file: decide by its type
    for marker, file_ext in (("pdf", ".pdf"), ("wordprocessingml", ".docx"), ("spreadsheetml", ".xlsx"),
                             ("csv", ".csv"), ("text/plain", ".txt"), ("markdown", ".md")):
        if marker in kind:
            return _file_sections(res.content, file_ext, url)
    raise SourceError("This Drive file type is not supported. Use PDF, Word, Excel, CSV or text files.")


# ---------- Notion (official API with the owner's integration secret) ----------

NOTION_API = "https://api.notion.com/v1"
MAX_NOTION_BLOCKS = 1500
TEXT_BLOCKS = ("paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item",
               "to_do", "toggle", "quote", "callout", "code")


def notion_page_id(url: str) -> str:
    m = re.search(r"([0-9a-f]{32})(?:[?#]|$)", url.replace("-", "").lower())
    if not m:
        raise SourceError("The Notion link does not contain a page id.")
    h = m.group(1)
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def _rich(items) -> str:
    return "".join(i.get("plain_text", "") for i in items or [])


def notion(url: str, token: str, client: httpx.Client | None = None) -> list[Section]:
    client = client or new_client()
    headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"}
    page_id = notion_page_id(url)

    def get(path: str) -> dict:
        res = client.get(f"{NOTION_API}{path}", headers=headers)
        if res.status_code == 401:
            raise SourceError("Notion rejected the integration secret. Copy it again from notion.so/my-integrations.")
        if res.status_code in (403, 404):
            raise SourceError("Notion did not share this page. Open the page, click ••• → Connections and add your integration.")
        if res.status_code != 200:
            raise SourceError(f"Notion answered with error {res.status_code}.")
        return res.json()

    page = get(f"/pages/{page_id}")
    title = next((_rich(p.get("title")) for p in page.get("properties", {}).values() if p.get("type") == "title"), "")
    lines, count = [title] if title else [], 0

    def walk(block_id: str, depth: int):
        nonlocal count
        cursor = None
        while count < MAX_NOTION_BLOCKS:
            data = get(f"/blocks/{block_id}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else ""))
            for block in data.get("results", []):
                count += 1
                kind = block.get("type")
                body = block.get(kind, {}) or {}
                if kind in TEXT_BLOCKS:
                    text = _rich(body.get("rich_text"))
                    if text:
                        lines.append(("# " if kind.startswith("heading") else "- " if "list" in kind else "") + text)
                elif kind == "table_row":
                    lines.append(" | ".join(_rich(cell) for cell in body.get("cells", [])))
                elif kind == "child_page":
                    lines.append(f"# {body.get('title', '')}")
                if block.get("has_children") and depth < 3:
                    walk(block["id"], depth + 1)
            if not data.get("has_more"):
                break
            cursor = data.get("next_cursor")

    walk(page_id, 0)
    return [Section("\n".join(lines), title or "Notion page", url)]


# ---------- YouTube captions ----------

def youtube_id(url: str) -> str:
    parts = urlparse(url)
    if parts.hostname and parts.hostname.endswith("youtu.be"):
        vid = parts.path.strip("/")[:11]
    elif "/shorts/" in parts.path or "/live/" in parts.path:
        vid = parts.path.rstrip("/").split("/")[-1][:11]
    else:
        vid = (parse_qs(parts.query).get("v") or [""])[0][:11]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
        raise SourceError("This is not a YouTube video link.")
    return vid


def youtube(url: str) -> list[Section]:
    """Captions grouped into two-minute parts, each linking to its moment in the video."""
    vid = youtube_id(url)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        api = YouTubeTranscriptApi()
        listing = api.list(vid)
        try:
            transcript = listing.find_transcript(["en", "en-IN", "hi"])
        except Exception:
            transcript = next(iter(listing))
        snippets = [(s.start, s.text) for s in transcript.fetch()]
    except Exception as ex:
        log.info("YouTube captions failed for %s: %s", vid, type(ex).__name__)
        raise SourceError("Could not read captions for this video: it may have none, or YouTube blocked the request. "
                          "Try again later, or upload the transcript as a text file.")
    sections, block, block_start = [], [], 0.0
    for start, text in snippets:
        if block and start - block_start >= 120:
            sections.append(_youtube_section(vid, block_start, block))
            block, block_start = [], start
        if not block:
            block_start = start
        block.append(text.replace("\n", " "))
    if block:
        sections.append(_youtube_section(vid, block_start, block))
    return sections


def _youtube_section(vid: str, start: float, texts: list[str]) -> Section:
    s = int(start)
    return Section(" ".join(texts), f"at {s // 60}:{s % 60:02d}", f"https://youtu.be/{vid}?t={s}")


# ---------- dispatcher used by the worker ----------

def fetch_sections(kind: str, msg: dict) -> list[Section]:
    try:
        return _fetch_sections(kind, msg)
    except httpx.HTTPError as ex:
        raise SourceError(f"The source could not be reached ({type(ex).__name__}). Try Sync again later.") from ex


def _fetch_sections(kind: str, msg: dict) -> list[Section]:
    url = (msg.get("sourceUrl") or "").strip()
    if kind == "website":
        return crawl(url, int(msg.get("maxPages") or 30))
    if kind == "google":
        return google(url)
    if kind == "notion":
        return notion(url, msg.get("sourceSecret") or "")
    if kind == "youtube":
        return youtube(url)
    raise SourceError(f"Unknown source type: {kind}")
