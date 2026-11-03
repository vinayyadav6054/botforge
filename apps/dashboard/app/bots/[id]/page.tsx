"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { api, Bot, BotDocument, GATEWAY_ORIGIN } from "@/lib/api";

const ALLOWED = [".pdf", ".txt", ".md", ".docx"];
const MAX_BYTES = 10 * 1024 * 1024;
const isProcessing = (d: BotDocument) => d.status === "Uploaded";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatusBadge({ doc }: { doc: BotDocument }) {
  if (doc.status === "Ready") return <span className="badge ready">Ready · {doc.chunkCount ?? 0} chunks</span>;
  if (doc.status === "Failed") return <span className="badge failed" title={doc.error ?? ""}>Failed</span>;
  if (doc.status === "UploadedUnqueued") return <span className="badge failed">Not queued</span>;
  return <span className="badge processing">Processing…</span>;
}

function BotDetail({ id }: { id: string }) {
  const router = useRouter();
  const [bot, setBot] = useState<Bot | null>(null);
  const [docs, setDocs] = useState<BotDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [welcome, setWelcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setDocs(await api.listDocuments(id));
  }, [id]);

  useEffect(() => {
    api.getBot(id)
      .then((b) => {
        setBot(b);
        setName(b.name);
        setWelcome(b.welcomeMessage);
        return loadDocs();
      })
      .catch((e: Error & { status?: number }) =>
        setError(e.status === 404 ? "This bot does not exist (or belongs to another workspace)." : e.message));
  }, [id, loadDocs]);

  // poll while any document is still being processed by the ingestion worker
  const processing = docs.some(isProcessing);
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => loadDocs().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [processing, loadDocs]);

  // live preview: load the real widget from the gateway on this page
  useEffect(() => {
    if (!preview || !bot) return;
    const s = document.createElement("script");
    s.src = `${GATEWAY_ORIGIN}/widget.js?v=${Date.now()}`;
    s.dataset.botKey = bot.publicKey;
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-botforge]").forEach((el) => el.remove());
    };
  }, [preview, bot]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const b = await api.updateBot(id, name.trim(), welcome.trim());
      setBot(b);
      flash("Settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  }

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED.includes(ext)) {
        setError(`${file.name}: only ${ALLOWED.join(", ")} files are supported.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is larger than 10 MB.`);
        continue;
      }
      setUploading(file.name);
      try {
        await api.uploadDocument(id, file);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    await loadDocs();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  }

  async function reprocess(doc: BotDocument) {
    try {
      await api.reprocessDocument(id, doc.id);
      await loadDocs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeDoc(doc: BotDocument) {
    if (!confirm(`Delete "${doc.fileName}"? The bot will no longer use it to answer.`)) return;
    try {
      await api.deleteDocument(id, doc.id);
      await loadDocs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeBot() {
    if (!bot || !confirm(`Delete the bot "${bot.name}" and all its documents? This cannot be undone.`)) return;
    try {
      await api.deleteBot(id);
      router.replace("/bots");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const snippet = bot
    ? `<script src="${GATEWAY_ORIGIN}/widget.js" data-bot-key="${bot.publicKey}" async></script>`
    : "";

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the snippet and copy it manually.");
    }
  }

  if (!bot) {
    return error ? (
      <div className="card">
        <div className="alert error" role="alert">{error}</div>
        <Link href="/bots">← Back to bots</Link>
      </div>
    ) : (
      <span className="spinner" aria-label="Loading" />
    );
  }

  const readyCount = docs.filter((d) => d.status === "Ready").length;

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href="/bots">← All bots</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{bot.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {readyCount} of {docs.length} document{docs.length === 1 ? "" : "s"} ready
          </p>
        </div>
        <button className="btn" onClick={() => setPreview((p) => !p)} disabled={readyCount === 0}
          title={readyCount === 0 ? "Upload a document first" : ""}>
          {preview ? "Close preview" : "Test your bot"}
        </button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {preview && (
        <div className="alert ok" role="status">
          Preview is on: use the chat bubble in the bottom-right corner, exactly as visitors will.
        </div>
      )}

      <section className="card">
        <h2>Knowledge</h2>
        <div
          className={`dropzone${dragOver ? " over" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        >
          {uploading ? (
            <span><span className="spinner" style={{ verticalAlign: "middle" }} /> Uploading {uploading}…</span>
          ) : (
            <>
              <strong>Drop files here</strong> or click to choose
              <div className="small">PDF, DOCX, TXT or Markdown · up to 10 MB each</div>
            </>
          )}
        </div>
        <input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} hidden
          aria-label="Upload documents" onChange={(e) => e.target.files && upload(e.target.files)} />

        {docs.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr><th>File</th><th>Size</th><th>Status</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.fileName}
                      {d.status === "Failed" && d.error && <div className="small" style={{ color: "var(--danger)" }}>{d.error}</div>}
                    </td>
                    <td className="muted">{formatSize(d.sizeBytes)}</td>
                    <td><StatusBadge doc={d} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {(d.status === "Failed" || d.status === "UploadedUnqueued") && (
                        <button className="btn secondary small" onClick={() => reprocess(d)}>Retry</button>
                      )}{" "}
                      <button className="btn danger small" onClick={() => removeDoc(d)} aria-label={`Delete ${d.fileName}`}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Add to your website</h2>
        <p className="muted small">Paste this just before the closing <code>&lt;/body&gt;</code> tag of your site.</p>
        <pre className="snippet" data-testid="embed-snippet">{snippet}</pre>
        <button className="btn secondary small" style={{ marginTop: 10 }} onClick={copySnippet}>
          {copied ? "Copied!" : "Copy snippet"}
        </button>
      </section>

      <form className="card" onSubmit={save} aria-label="Bot settings">
        <h2>Settings</h2>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="welcomeMessage">Welcome message</label>
          <textarea id="welcomeMessage" maxLength={500} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>

      <section className="card">
        <h2>Danger zone</h2>
        <p className="muted small">Deleting the bot removes its documents and stops the widget on every site using it.</p>
        <button className="btn danger" onClick={removeBot}>Delete bot</button>
      </section>
    </>
  );
}

export default function BotPage() {
  const params = useParams<{ id: string }>();
  return (
    <Shell>
      <BotDetail id={params.id} />
    </Shell>
  );
}
