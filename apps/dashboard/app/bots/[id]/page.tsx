"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ConversationsSection from "@/components/ConversationsSection";
import LeadsSection from "@/components/LeadsSection";
import Shell from "@/components/Shell";
import { api, Bot, BotDocument, gatewayOrigin } from "@/lib/api";

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
  const [leadEnabled, setLeadEnabled] = useState(false);
  const [leadPrompt, setLeadPrompt] = useState("");
  const [leadAfter, setLeadAfter] = useState(2);
  const [questions, setQuestions] = useState<string[]>(["", "", "", ""]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);
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
        setLeadEnabled(b.leadCaptureEnabled);
        setLeadPrompt(b.leadPrompt);
        setLeadAfter(b.leadAfterMessages);
        setQuestions(padQuestions(b.suggestedQuestions));
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
    s.src = `${gatewayOrigin()}/widget.js?v=${Date.now()}`;
    s.dataset.botKey = bot.publicKey;
    if (color !== DEFAULT_COLOR) s.dataset.color = color;
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-botforge]").forEach((el) => el.remove());
    };
  }, [preview, bot, color]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const b = await api.updateBot(id, {
        name: name.trim(),
        welcomeMessage: welcome.trim(),
        leadCaptureEnabled: leadEnabled,
        leadPrompt: leadPrompt.trim(),
        leadAfterMessages: Math.min(20, Math.max(0, Math.round(leadAfter) || 0)),
        suggestedQuestions: questions.map((q) => q.trim()).filter(Boolean),
      });
      setBot(b);
      setLeadPrompt(b.leadPrompt);
      setLeadAfter(b.leadAfterMessages);
      setQuestions(padQuestions(b.suggestedQuestions));
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
    ? `<script src="${gatewayOrigin()}/widget.js" data-bot-key="${bot.publicKey}"${color !== DEFAULT_COLOR ? ` data-color="${color}"` : ""} async></script>`
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
  const chunks = docs.reduce((n, d) => n + (d.status === "Ready" ? d.chunkCount ?? 0 : 0), 0);

  return (
    <>
      <Link href="/bots" className="crumb small">← All bots</Link>
      {/* the button sits next to the name: on the right the open chat panel would cover it */}
      <div className="page-head start">
        <div className="row" style={{ gap: 14, alignItems: "center" }}>
          <span className="bot-avatar" aria-hidden>{bot.name.slice(0, 1).toUpperCase()}</span>
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
          Preview is on: use the chat bubble in the bottom-right corner, exactly as visitors will.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="label">Status</div>
          <div style={{ marginTop: 10 }}>
            {readyCount > 0
              ? <span className="badge ready">● Ready to answer</span>
              : <span className="badge processing">Needs a document</span>}
          </div>
        </div>
        <div className="stat">
          <div className="label">Documents</div>
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
              <span className="muted small">The bot answers only from these files</span>
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
                  <div className="small">PDF, DOCX, TXT or Markdown · up to 10 MB each</div>
                </>
              )}
            </div>
            <input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} hidden
              aria-label="Upload documents" onChange={(e) => e.target.files && upload(e.target.files)} />

            {docs.length === 0 && !uploading && (
              <p className="small muted" style={{ margin: "12px 0 0" }}>
                No documents yet. Brochures, fee lists, timings and FAQs work best.{" "}
                <a href="/samples/sunrise-academy.txt" download>Try a sample document</a>.
              </p>
            )}

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
                          <div className="file-cell">
                            <span className="file-icon" aria-hidden>{d.fileName.split(".").pop()}</span>
                            <div>
                              {d.fileName}
                              {d.status === "Failed" && d.error && <div className="small" style={{ color: "var(--danger)" }}>{d.error}</div>}
                            </div>
                          </div>
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

          <div id="leads" style={{ scrollMarginTop: 84 }}>
            <LeadsSection botId={id} enabled={bot.leadCaptureEnabled} />
          </div>

          <ConversationsSection botId={id} />

          <section className="card" id="install">
            <div className="card-head">
              <div className="section-title"><span className="section-icon" aria-hidden>🧩</span><h2>Add to your website</h2></div>
            </div>
            <div className="field">
              <span className="small" style={{ fontWeight: 700, display: "block", marginBottom: 6 }}>Chat colour</span>
              <div className="swatches" role="group" aria-label="Chat colour">
                {COLORS.map((c) => (
                  <button key={c.value} type="button" className="swatch" style={{ background: c.value }}
                    aria-pressed={color === c.value} aria-label={c.name} title={c.name} onClick={() => setColor(c.value)} />
                ))}
                <span className="small muted">Pick your brand colour; it is added to the code below.</span>
              </div>
            </div>
            <p className="muted small">Paste this just before the closing <code>&lt;/body&gt;</code> tag of your site.</p>
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

          <form className="card" onSubmit={save} aria-label="Bot settings" id="settings">
            <div className="card-head">
              <div className="section-title"><span className="section-icon" aria-hidden>⚙️</span><h2>Settings</h2></div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" type="text" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="welcomeMessage">Welcome message</label>
                <textarea id="welcomeMessage" maxLength={500} value={welcome} rows={2} style={{ minHeight: 44 }}
                  onChange={(e) => setWelcome(e.target.value)} />
              </div>
            </div>

            <fieldset className="field questions">
              <legend>Suggested questions <span className="muted small">(optional, up to 4)</span></legend>
              <p className="small muted" style={{ margin: "0 0 8px" }}>
                Shown as buttons under the welcome message, so visitors can ask with one tap.
              </p>
              <div className="question-grid">
                {questions.map((q, i) => (
                  <input key={i} type="text" maxLength={120} value={q} aria-label={`Suggested question ${i + 1}`}
                    placeholder={QUESTION_EXAMPLES[i]}
                    onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))} />
                ))}
              </div>
            </fieldset>

            <h3 className="subhead">Lead capture</h3>
            <div className="field">
              <label className="check" htmlFor="leadEnabled">
                <input id="leadEnabled" type="checkbox" checked={leadEnabled} onChange={(e) => setLeadEnabled(e.target.checked)} />
                Ask visitors for their name and phone number
              </label>
              <p className="small muted" style={{ margin: "4px 0 0 28px" }}>
                Adds a call-back button to the chat and collects enquiries in the Leads list.
              </p>
            </div>
            {leadEnabled && (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="leadPrompt">Invitation text</label>
                  <textarea id="leadPrompt" maxLength={300} value={leadPrompt} onChange={(e) => setLeadPrompt(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="leadAfter">Show the form automatically after this many answers</label>
                  <input id="leadAfter" type="number" min={0} max={20} value={leadAfter}
                    onChange={(e) => setLeadAfter(Number(e.target.value))} />
                  <p className="small muted" style={{ margin: "4px 0 0" }}>0 = only when the visitor taps the call-back button.</p>
                </div>
              </div>
            )}

            <button className="btn" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </form>

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

/** The widget's own default colour: the snippet only gets data-color when another one is picked. */
const DEFAULT_COLOR = "#4f46e5";
const COLORS = [
  { name: "Indigo (default)", value: DEFAULT_COLOR },
  { name: "Ember", value: "#c8461f" },
  { name: "Blue", value: "#1d4ed8" },
  { name: "Teal", value: "#0f766e" },
  { name: "Green", value: "#15803d" },
  { name: "Rose", value: "#be185d" },
  { name: "Charcoal", value: "#1f2937" },
];

const QUESTION_EXAMPLES = [
  "e.g. What are the fees?",
  "e.g. When does the next batch start?",
  "e.g. Is there a scholarship test?",
  "e.g. Do you offer a free demo class?",
];

/** Always four boxes in the form; the bot keeps only the filled ones. */
function padQuestions(qs: string[] | undefined): string[] {
  return [...(qs ?? []), "", "", "", ""].slice(0, 4);
}

export default function BotPage() {
  const params = useParams<{ id: string }>();
  return (
    <Shell>
      <BotDetail id={params.id} />
    </Shell>
  );
}
