"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import AddSource, { SYNC_OPTIONS } from "@/components/AddSource";
import ConversationsSection from "@/components/ConversationsSection";
import LeadsSection from "@/components/LeadsSection";
import Playground from "@/components/Playground";
import QaSection, { QaDraft } from "@/components/QaSection";
import SettingsForm from "@/components/SettingsForm";
import Shell from "@/components/Shell";
import { api, Bot, BotDocument, gatewayOrigin } from "@/lib/api";

const ALLOWED = [".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"];
const MAX_BYTES = 10 * 1024 * 1024;
const isProcessing = (d: BotDocument) => d.status === "Uploaded";
const KIND_ICON: Record<string, string> = { website: "🌐", google: "📗", notion: "📓", youtube: "▶️" };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
}

function StatusBadge({ doc }: { doc: BotDocument }) {
  if (doc.status === "Ready") return <span className="badge ready">Ready · {doc.chunkCount ?? 0} chunks</span>;
  if (doc.status === "Failed") return <span className="badge failed" title={doc.error ?? ""}>Failed</span>;
  if (doc.status === "UploadedUnqueued") return <span className="badge failed">Not queued</span>;
  return <span className="badge processing">{doc.kind === "file" ? "Processing…" : "Reading…"}</span>;
}

function BotDetail({ id }: { id: string }) {
  const router = useRouter();
  const [bot, setBot] = useState<Bot | null>(null);
  const [docs, setDocs] = useState<BotDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<QaDraft | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setDocs(await api.listDocuments(id));
  }, [id]);

  useEffect(() => {
    api.getBot(id)
      .then((b) => {
        setBot(b);
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

  // live preview: load the real widget from the gateway on this page (it reads the saved look itself)
  useEffect(() => {
    if (!preview || !bot) return;
    const s = document.createElement("script");
    s.src = `${gatewayOrigin()}/widget.js?v=${Date.now()}`;
    s.dataset.botKey = bot.publicKey;
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-botforge]").forEach((el) => el.remove());
    };
  }, [preview, bot]);

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

  async function setSync(doc: BotDocument, days: number) {
    try {
      await api.setSyncInterval(id, doc.id, days);
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

  const snippet = bot ? `<script src="${gatewayOrigin()}/widget.js" data-bot-key="${bot.publicKey}" async></script>` : "";

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the snippet and copy it manually.");
    }
  }

  const correct = useCallback((question: string, answer: string) => setDraft({ question, answer, fromQuestion: question }), []);
  const clearDraft = useCallback(() => setDraft(null), []);

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
  const chunks = docs.reduce((n, d) => n + (d.status === "Ready" ? d.chunkCount ?? 0 : 0), 0);

  return (
    <>
      <Link href="/bots" className="crumb small">← All bots</Link>
      {/* the button sits next to the name: on the right the open chat panel would cover it */}
      <div className="page-head start">
        <div className="row" style={{ gap: 14, alignItems: "center" }}>
          {bot.avatarDataUrl
            ? <img className="bot-avatar" src={bot.avatarDataUrl} alt="" />
            : <span className="bot-avatar" aria-hidden style={bot.widgetColor ? { background: bot.widgetColor } : undefined}>{bot.name.slice(0, 1).toUpperCase()}</span>}
          <div>
            <h1>{bot.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {readyCount} of {docs.length} document{docs.length === 1 ? "" : "s"} ready
            </p>
          </div>
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
          Preview is on: use the chat bubble in the bottom corner, exactly as visitors will.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="label">Status</div>
          <div style={{ marginTop: 10 }}>
            {readyCount > 0 ? <span className="badge ready">● Ready to answer</span> : <span className="badge processing">Needs knowledge</span>}
          </div>
        </div>
        <div className="stat">
          <div className="label">Sources</div>
          <div className="value">{docs.length}</div>
          <div className="hint">{readyCount} ready</div>
        </div>
        <div className="stat">
          <div className="label">Knowledge pieces</div>
          <div className="value">{chunks}</div>
          <div className="hint">searched for every question</div>
        </div>
        <div className="stat">
          <div className="label">Lead capture</div>
          <div className="value">{bot.leadCaptureEnabled ? "On" : "Off"}</div>
          <div className="hint">{bot.leadCaptureEnabled ? "visitors can ask for a call back" : "turn it on in Settings"}</div>
        </div>
      </div>

      <div className="detail">
        <nav className="side-nav" aria-label="Bot sections">
          <a href="#knowledge">📄 Knowledge</a>
          <a href="#answers">✍️ Your answers</a>
          <a href="#playground">🧪 Playground</a>
          <a href="#leads">📞 Leads</a>
          <a href="#conversations">💬 Conversations</a>
          <a href="#install">🧩 Install</a>
          <a href="#settings">⚙️ Settings</a>
          <a href="#danger">⚠️ Danger zone</a>
        </nav>

        <div>
          <section className="card" id="knowledge">
            <div className="card-head">
              <div className="section-title"><span className="section-icon" aria-hidden>📄</span><h2>Knowledge</h2></div>
              <span className="muted small">The bot answers only from these sources</span>
            </div>
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
                  <span className="drop-icon" aria-hidden>⬆</span>
                  <strong>Drop files here</strong> or click to choose
                  <div className="small">PDF, Word, Excel, CSV, TXT or Markdown · up to 10 MB each</div>
                </>
              )}
            </div>
            <input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} hidden
              aria-label="Upload documents" onChange={(e) => e.target.files && upload(e.target.files)} />

            <div className="or-divider"><span>or add from the web</span></div>
            <AddSource botId={id} onAdded={() => { void loadDocs(); flash("Added. Reading it now, this can take a minute."); }} />

            {docs.length === 0 && !uploading && (
              <p className="small muted" style={{ margin: "12px 0 0" }}>
                No knowledge yet. Brochures, fee lists, timings and FAQs work best.{" "}
                <a href="/samples/sunrise-academy.txt" download>Try a sample document</a>.
              </p>
            )}

            {docs.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr><th>Source</th><th>Size / updates</th><th>Status</th><th aria-label="Actions" /></tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className="file-cell">
                            <span className="file-icon" aria-hidden>{KIND_ICON[d.kind] ?? d.fileName.split(".").pop()}</span>
                            <div style={{ minWidth: 0 }}>
                              {d.fileName}
                              {d.sourceUrl && (
                                <div className="small muted source-url">
                                  <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.sourceUrl.replace(/^https?:\/\//, "")}</a>
                                </div>
                              )}
                              {d.status === "Failed" && d.error && <div className="small" style={{ color: "var(--danger)" }}>{d.error}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="muted small">
                          {d.kind === "file" ? formatSize(d.sizeBytes) : (
                            <>
                              <select className="status-select" value={d.syncIntervalDays} onChange={(e) => void setSync(d, Number(e.target.value))}
                                aria-label={`Updates for ${d.fileName}`}>
                                {SYNC_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
                              </select>
                              <div>Last read: {when(d.lastSyncedAt)}</div>
                            </>
                          )}
                        </td>
                        <td><StatusBadge doc={d} /></td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {(d.status === "Failed" || d.status === "UploadedUnqueued") && d.kind === "file" && (
                            <button className="btn secondary small" onClick={() => reprocess(d)}>Retry</button>
                          )}
                          {d.kind !== "file" && d.status !== "Uploaded" && (
                            <button className="btn secondary small" onClick={() => reprocess(d)}>Sync now</button>
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

          <QaSection botId={id} draft={draft} onDraftUsed={clearDraft} />

          <Playground publicKey={bot.publicKey} ready={readyCount > 0} onCorrect={correct} />

          <div id="leads" style={{ scrollMarginTop: 84 }}>
            <LeadsSection botId={id} enabled={bot.leadCaptureEnabled} />
          </div>

          <ConversationsSection botId={id} onCorrect={correct} />

          <section className="card" id="install">
            <div className="card-head">
              <div className="section-title"><span className="section-icon" aria-hidden>🧩</span><h2>Add to your website</h2></div>
            </div>
            <p className="muted small">
              Paste this just before the closing <code>&lt;/body&gt;</code> tag of your site. Colour, side and logo come from{" "}
              <a href="#settings">Settings → Look</a>, so you never need to change this code.
            </p>
            <pre className="snippet" data-testid="embed-snippet">{snippet}</pre>
            <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
              <button className="btn secondary small" onClick={copySnippet}>
                {copied ? "Copied!" : "Copy snippet"}
              </button>
              <div className="platforms" style={{ marginTop: 0 }}>
                <span>WordPress</span><span>Wix</span><span>Shopify</span><span>Webflow</span><span>Any HTML</span>
              </div>
            </div>
          </section>

          <SettingsForm key={bot.id} bot={bot} onSaved={(b, message) => { setBot(b); flash(message); }} />

          <section className="card danger-zone" id="danger">
            <h2>Danger zone</h2>
            <p className="muted small">Deleting the bot removes its documents and stops the widget on every site using it.</p>
            <button className="btn danger" onClick={removeBot}>Delete bot</button>
          </section>
        </div>
      </div>
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
