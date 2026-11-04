"""Print shell exports derived from DATABASE_URL (a postgresql:// URL, as Neon shows it).

- DATABASE_URL for the Python services (libpq understands the URL as is)
- ConnectionStrings__Default for the .NET services (Npgsql needs key=value form)

Neon's "-pooler" host is swapped for the direct host: EF migrations take advisory locks,
which a transaction-mode pooler does not support.
"""
import os
import shlex
from urllib.parse import parse_qs, unquote, urlencode, urlsplit, urlunsplit

url = urlsplit(os.environ["DATABASE_URL"].strip())
if url.scheme not in ("postgres", "postgresql"):
    raise SystemExit("DATABASE_URL must start with postgresql://")

host = (url.hostname or "").replace("-pooler.", ".")
query = parse_qs(url.query)
sslmode = query.get("sslmode", ["require" if host not in ("localhost", "127.0.0.1") and "." in host else "disable"])[0]
query["sslmode"] = [sslmode]
# libpq-only option; Npgsql negotiates channel binding by itself
query.pop("channel_binding", None)

netloc = url.netloc.rsplit("@", 1)[0] + "@" + host + (f":{url.port}" if url.port else "")
python_url = urlunsplit((url.scheme, netloc, url.path, urlencode(query, doseq=True), ""))


def quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"' if any(c in value for c in ';"\'= ') else value


npgsql_ssl = {"disable": "Disable", "allow": "Allow", "prefer": "Prefer",
              "require": "Require", "verify-ca": "VerifyCA", "verify-full": "VerifyFull"}[sslmode]
dotnet = ";".join([
    f"Host={host}",
    f"Port={url.port or 5432}",
    f"Database={quote(unquote(url.path.lstrip('/')) or 'postgres')}",
    f"Username={quote(unquote(url.username or ''))}",
    f"Password={quote(unquote(url.password or ''))}",
    f"SSL Mode={npgsql_ssl}",
])

print(f"export DATABASE_URL={shlex.quote(python_url)}")
print(f"export ConnectionStrings__Default={shlex.quote(dotnet)}")
