"""Unit tests for online sources, with the internet replaced by httpx.MockTransport."""
import json
from types import SimpleNamespace

import httpx
import pytest

from app import config, sources, worker
from app.sources import SourceError

pytestmark = pytest.mark.unit

PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Every host resolves to a public address unless a test says otherwise; no real DNS or HTTP."""
    monkeypatch.setattr(sources, "_resolve", lambda host: [PUBLIC_IP])
    monkeypatch.setattr(sources, "CRAWL_DELAY", 0)
    monkeypatch.setattr(config, "ALLOW_PRIVATE_SOURCES", False, raising=False)


def client(routes: dict):
    """routes: url -> (status, content-type, body) or (status, {"location": ...})."""
    def handler(request: httpx.Request):
        key = str(request.url)
        if key not in routes:
            return httpx.Response(404, text="not found")
        status, kind, body = routes[key]
        if isinstance(kind, dict):
            return httpx.Response(status, headers=kind)
        return httpx.Response(status, headers={"content-type": kind}, content=body if isinstance(body, bytes) else body.encode())
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


HOME = """<html><head><title>Sunrise Academy</title><script>var x=1</script></head><body>
<nav><a href="/fees">Fees</a> <a href="/about#team">About</a> <a href="https://other.example/">Other</a>
<a href="/logo.png">logo</a></nav>
<main><h1>Welcome to Sunrise Academy</h1><p>We prepare students for JEE and NEET in Pune since 2011.</p></main>
<footer>Copyright</footer></body></html>"""
FEES = """<html><head><title>Fees</title></head><body><main>
<table><tr><th>Course</th><th>Fee</th></tr><tr><td>JEE</td><td>68,000</td></tr></table>
<p>Fees can be paid in three instalments every year.</p></main></body></html>"""
ABOUT = "<html><head><title>About</title></head><body><p>Our faculty has 15 years of teaching experience in Pune.</p></body></html>"


# ---------- address safety ----------

@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "0.0.0.0"])
def test_private_and_metadata_addresses_are_refused(monkeypatch, ip):
    monkeypatch.setattr(sources, "_resolve", lambda host: [ip])
    with pytest.raises(SourceError, match="not reachable from the internet"):
        sources.check_public("https://looks-innocent.example/")


@pytest.mark.parametrize("url", ["ftp://x.example/", "file:///etc/passwd", "javascript:alert(1)", "https://"])
def test_only_web_addresses_are_allowed(url):
    with pytest.raises(SourceError):
        sources.check_public(url)


def test_redirects_to_private_addresses_are_refused(monkeypatch):
    monkeypatch.setattr(sources, "_resolve", lambda host: ["10.0.0.1"] if host == "internal.example" else [PUBLIC_IP])
    c = client({"https://site.example/": (302, {"location": "http://internal.example/admin"}, None)})
    with pytest.raises(SourceError, match="not reachable"):
        sources.fetch(c, "https://site.example/")


def test_big_responses_are_cut_off(monkeypatch):
    monkeypatch.setattr(sources, "MAX_BYTES", 100)
    c = client({"https://site.example/": (200, "text/html", "x" * 500)})
    with pytest.raises(SourceError, match="larger than"):
        sources.fetch(c, "https://site.example/")


# ---------- website crawl ----------

def test_page_text_drops_menus_and_scripts_and_keeps_tables():
    section, links = sources.html_to_section("https://site.example/fees", FEES)
    assert section.location == "Fees" and section.url == "https://site.example/fees"
    assert "Course: JEE; Fee: 68,000" in section.text
    section, links = sources.html_to_section("https://site.example/", HOME)
    assert "var x" not in section.text and "Copyright" not in section.text and "Fees" not in section.text.split("\n", 1)[1]
    assert "https://site.example/about" in links   # fragment removed


def test_crawl_follows_same_site_links_and_respects_robots_and_limits():
    c = client({
        "https://site.example/robots.txt": (200, "text/plain", "User-agent: *\nDisallow: /about"),
        "https://site.example/": (200, "text/html; charset=utf-8", HOME),
        "https://site.example/fees": (200, "text/html", FEES),
        "https://site.example/about": (200, "text/html", ABOUT),
    })
    sections = sources.crawl("https://site.example/", max_pages=10, client=c)
    assert [s.location for s in sections] == ["Sunrise Academy", "Fees"]   # /about blocked by robots.txt

    assert len(sources.crawl("https://site.example/", max_pages=1, client=c)) == 1


def test_crawl_uses_the_sitemap():
    c = client({
        "https://site.example/sitemap.xml": (200, "application/xml",
                                             "<urlset><url><loc>https://site.example/about</loc></url></urlset>"),
        "https://site.example/": (200, "text/html", "<html><body><p>Short home page text without links but long enough.</p></body></html>"),
        "https://site.example/about": (200, "text/html", ABOUT),
    })
    assert [s.location for s in sources.crawl("https://site.example/", 10, client=c)][-1] == "About"


def test_unreachable_or_empty_sites_give_clear_errors():
    with pytest.raises(SourceError, match="error 500"):
        sources.crawl("https://site.example/", 5, client=client({"https://site.example/": (500, "text/html", "oops")}))
    with pytest.raises(SourceError, match="No readable text"):
        sources.crawl("https://site.example/", 5, client=client({"https://site.example/": (200, "text/html", "<div id=app></div>")}))


# ---------- Google ----------

@pytest.mark.parametrize("url,export,ext", [
    ("https://docs.google.com/document/d/ABCDEFGHIJKLMNOPQRSTUV123/edit", "https://docs.google.com/document/d/ABCDEFGHIJKLMNOPQRSTUV123/export?format=txt", ".txt"),
    ("https://docs.google.com/spreadsheets/d/ABCDEFGHIJKLMNOPQRSTUV123/edit#gid=42", "https://docs.google.com/spreadsheets/d/ABCDEFGHIJKLMNOPQRSTUV123/export?format=csv&gid=42", ".csv"),
    ("https://docs.google.com/presentation/d/ABCDEFGHIJKLMNOPQRSTUV123/edit", "https://docs.google.com/presentation/d/ABCDEFGHIJKLMNOPQRSTUV123/export/txt", ".txt"),
    ("https://drive.google.com/file/d/ABCDEFGHIJKLMNOPQRSTUV123/view", "https://drive.google.com/uc?export=download&id=ABCDEFGHIJKLMNOPQRSTUV123", ""),
])
def test_google_links_map_to_exports(url, export, ext):
    assert sources.google_export_url(url) == (export, ext)


def test_google_sheet_rows_and_private_files():
    url = "https://docs.google.com/spreadsheets/d/ABCDEFGHIJKLMNOPQRSTUV123/edit"
    export = "https://docs.google.com/spreadsheets/d/ABCDEFGHIJKLMNOPQRSTUV123/export?format=csv"
    sections = sources.google(url, client({export: (200, "text/csv", "Course,Fee\nJEE,68000\n")}))
    assert sections[0].text == "Course: JEE; Fee: 68000" and sections[0].url == url
    with pytest.raises(SourceError, match="Anyone with the link"):
        sources.google(url, client({export: (200, "text/html", "<html>Sign in</html>")}))


# ---------- Notion ----------

def test_notion_page_ids():
    assert sources.notion_page_id("https://www.notion.so/Fees-0123456789abcdef0123456789abcdef?pvs=4") == \
        "01234567-89ab-cdef-0123-456789abcdef"
    with pytest.raises(SourceError):
        sources.notion_page_id("https://www.notion.so/no-id-here")


def test_notion_blocks_become_text_and_errors_are_explained():
    pid = "01234567-89ab-cdef-0123-456789abcdef"
    rt = lambda t: [{"plain_text": t}]
    def handler(request):
        assert request.headers["authorization"] == "Bearer ntn_x"
        path = request.url.path
        if path == f"/v1/pages/{pid}":
            return httpx.Response(200, json={"properties": {"Name": {"type": "title", "title": rt("Fee list")}}})
        if path == f"/v1/blocks/{pid}/children":
            return httpx.Response(200, json={"results": [
                {"id": "b1", "type": "heading_2", "heading_2": {"rich_text": rt("JEE")}, "has_children": False},
                {"id": "b2", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": rt("68,000 per year")}, "has_children": True},
            ], "has_more": False})
        if path == "/v1/blocks/b2/children":
            return httpx.Response(200, json={"results": [{"id": "b3", "type": "paragraph", "paragraph": {"rich_text": rt("3 instalments")}}], "has_more": False})
        return httpx.Response(404)
    c = httpx.Client(transport=httpx.MockTransport(handler))
    sections = sources.notion(f"https://www.notion.so/Fees-{pid.replace('-', '')}", "ntn_x", c)
    assert sections[0].text == "Fee list\n# JEE\n- 68,000 per year\n3 instalments"

    denied = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    with pytest.raises(SourceError, match="Connections"):
        sources.notion(f"https://www.notion.so/x-{pid.replace('-', '')}", "ntn_x", denied)


# ---------- YouTube ----------

@pytest.mark.parametrize("url", ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5", "https://youtu.be/dQw4w9WgXcQ",
                                 "https://www.youtube.com/shorts/dQw4w9WgXcQ"])
def test_youtube_ids(url):
    assert sources.youtube_id(url) == "dQw4w9WgXcQ"


def test_youtube_captions_are_grouped_with_time_links(monkeypatch):
    import youtube_transcript_api

    snippets = [SimpleNamespace(start=s, text=f"part {s}") for s in (0, 50, 130, 200)]
    transcript = SimpleNamespace(fetch=lambda: snippets)
    listing = SimpleNamespace(find_transcript=lambda langs: transcript)
    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", lambda: SimpleNamespace(list=lambda vid: listing))
    sections = sources.youtube("https://youtu.be/dQw4w9WgXcQ")
    assert [(s.location, s.url, s.text) for s in sections] == [
        ("at 0:00", "https://youtu.be/dQw4w9WgXcQ?t=0", "part 0 part 50"),
        ("at 2:10", "https://youtu.be/dQw4w9WgXcQ?t=130", "part 130 part 200"),
    ]


def test_youtube_failures_are_explained(monkeypatch):
    import youtube_transcript_api

    def boom():
        raise RuntimeError("blocked")
    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", boom)
    with pytest.raises(SourceError, match="captions"):
        sources.youtube("https://youtu.be/dQw4w9WgXcQ")


# ---------- worker ----------

def test_worker_reports_source_errors_to_the_owner(monkeypatch):
    monkeypatch.setattr(sources, "_resolve", lambda host: ["127.0.0.1"])
    published = []
    msg = {"documentId": "11111111-1111-1111-1111-111111111111", "tenantId": "22222222-2222-2222-2222-222222222222",
           "botId": "33333333-3333-3333-3333-333333333333", "kind": "website", "sourceUrl": "https://evil.example/",
           "fileName": "evil.example", "storageKey": "", "maxPages": 5}

    class Conn:
        closed = False
        def rollback(self): pass

    worker.Handler(Conn(), lambda k, p: published.append((k, p))).handle("document.uploaded", json.dumps(msg).encode())
    assert published[0][0] == "document.failed"
    assert "not reachable from the internet" in published[0][1]["error"]


def test_compressed_pages_are_read():
    """Most real sites send gzip; the body must be decoded exactly once."""
    import gzip

    page = gzip.compress(HOME.encode())
    c = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(
        200, headers={"content-type": "text/html", "content-encoding": "gzip"}, content=page)))
    res = sources.fetch(c, "https://site.example/")
    assert "Welcome to Sunrise Academy" in res.text
