"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import AddSource, { SYNC_OPTIONS } from "@/components/AddSource";
import ChannelsSection from "@/components/ChannelsSection";
import ConversationsSection from "@/components/ConversationsSection";
import CountUp from "@/components/CountUp";
import Icon, { IconName } from "@/components/Icon";
import LeadsSection from "@/components/LeadsSection";
import Playground from "@/components/Playground";
import QaSection, { QaDraft } from "@/components/QaSection";
import SettingsForm from "@/components/SettingsForm";
import Shell from "@/components/Shell";
import { api, Bot, BotDocument, gatewayOrigin, getSession } from "@/lib/api";

const ALLOWED = [".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"];
const MAX_BYTES = 10 * 1024 * 1024;
const isProcessing = (d: BotDocument) => d.status === "Uploaded";
const KIND_LABEL: Record<string, string> = { website: "WEB", google: "DOC", notion: "NOTE", youtube: "VID" };

type Tab = "overview" | "knowledge" | "answers" | "apps" | "leads" | "conversations" | "install" | "settings";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "knowledge", label: "Knowledge", icon: "book" },
  { id: "answers", label: "Test & answers", icon: "flask" },
  { id: "leads", label: "Leads", icon: "phone" },
  { id: "conversations", label: "Conversations", icon: "chat" },
  { id: "apps", label: "Messaging apps", icon: "apps" },
  { id: "install", label: "Install", icon: "code" },
  { id: "settings", label: "Settings", icon: "settings" },
];
const isTab = (v: string): v is Tab => TABS.some((t) => t.id === v);

/** Small per-browser flags for the setup checklist (best effort: storage may be blocked). */
function flag(key: string, set?: boolean): boolean {
  try {
    if (set) localStorage.setItem(key, "1");
    return localStorage.getItem(key) === "1";
  } catch {
    return !!set;
  }
}

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
  return <span className="badge processing"><span className="dot-pulse" aria-hidden />{doc.kind === "file" ? "Processing…" : "Reading…"}</span>;
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" aria-label={`${done} of ${total} steps done`}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} className="ring-bg" />
        <circle cx="32" cy="32" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} />
      </svg>
      <span>{done}/{total}</span>
    </div>
  );
}

function BotDetail({ id }: { id: string }) {
  const router = useRouter();
  const [bot, setBot] = useState<Bot | null>(null);
  const [docs, setDocs] = useState<BotDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<QaDraft | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [visited, setVisited] = useState<Set<Tab>>(new Set());
  const [newLeads, setNewLeads] = useState(0);
  const [channels, setChannels] = useState(0);
  const [, rerender] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setDocs(await api.listDocuments(id));
  }, [id]);

  useEffect(() => {
    if (!getSession()) return;
    api.getBot(id)
      .then((b) => {
        setBot(b);
        return loadDocs();
      })
      .catch((e: Error & { status?: number }) =>
        setError(e.status === 404 ? "This bot does not exist (or belongs to another workspace)." : e.message));
    // extras for the overview; the page works without them
    api.listLeads(id).then((l) => setNewLeads(l.filter((x) => x.status === "New").length)).catch(() => undefined);
    api.listChannels(id).then((c) => setChannels(c.length)).catch(() => undefined);
  }, [id, loadDocs]);

  // first screen: the address (#settings) if given, otherwise Knowledge until there is some, then the Overview
  useEffect(() => {
    if (tab || docs === null) return;
    const hash = window.location.hash.slice(1);
    open(isTab(hash) ? hash : docs.length === 0 ? "knowledge" : "overview", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, tab]);

  const open = useCallback((next: Tab, scroll = true) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
    history.replaceState(null, "", `#${next}`);
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // poll while any document is still being processed by the ingestion worker
  const processing = (docs ?? []).some(isProcessing);
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
    setTimeout(() => setNotice(null), 3200);
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
      flag(`bf-installed-${id}`, true);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the snippet and copy it manually.");
    }
  }

  const correct = useCallback((question: string, answer: string) => {
    setDraft({ question, answer, fromQuestion: question });
    open("answers");
  }, [open]);
  const clearDraft = useCallback(() => setDraft(null), []);
  const tested = useCallback(() => {
    flag(`bf-tested-${id}`, true);
    rerender((n) => n + 1);
  }, [id]);

  if (!bot) {
    return (
      <Shell>
        {error ? (
          <div className="card">
            <div className="alert error" role="alert">{error}</div>
            <Link href="/bots">← Back to bots</Link>
          </div>
        ) : (
          <div className="skeleton-page" aria-label="Loading">
            <div className="skel" style={{ width: 280, height: 40 }} />
            <div className="skel-row">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}</div>
            <div className="skel" style={{ height: 320 }} />
          </div>
        )}
      </Shell>
    );
  }

  const list = docs ?? [];
  const readyCount = list.filter((d) => d.status === "Ready").length;
  const chunks = list.reduce((n, d) => n + (d.status === "Ready" ? d.chunkCount ?? 0 : 0), 0);
  const color = bot.widgetColor ?? undefined;

  const steps: { label: string; hint: string; done: boolean; tab: Tab; cta: string }[] = [
    { label: "Add your knowledge", hint: "Brochure, fee list, menu or FAQ: the bot answers only from these.", done: readyCount > 0, tab: "knowledge", cta: "Upload" },
    { label: "Ask it a test question", hint: "See exactly what visitors will get, and fix any answer in one click.", done: flag(`bf-tested-${id}`), tab: "answers", cta: "Test" },
    { label: "Make it look like yours", hint: "Colour, logo, welcome message and suggested questions.", done: !!bot.widgetColor || bot.suggestedQuestions.length > 0 || !!bot.avatarDataUrl, tab: "settings", cta: "Customise" },
    { label: "Collect leads", hint: "Visitors leave their name and number; you call them back.", done: bot.leadCaptureEnabled, tab: "settings", cta: "Turn on" },
    { label: "Put it on your website", hint: "One line of code, works on WordPress, Wix, Shopify and any site.", done: flag(`bf-installed-${id}`), tab: "install", cta: "Get code" },
    { label: "Answer on WhatsApp too", hint: "Optional: same answers on WhatsApp, Instagram, Messenger and Telegram.", done: channels > 0, tab: "apps", cta: "Connect" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const badge = (t: Tab) => (t === "knowledge" && list.length ? list.length : t === "leads" && newLeads ? newLeads : null);

  const subnav = (
    <>
      <div className="side-bot">
        {bot.avatarDataUrl
          ? <img className="bot-avatar sm" src={bot.avatarDataUrl} alt="" />
          : <span className="bot-avatar sm" aria-hidden style={color ? { background: color } : undefined}>{bot.name.slice(0, 1).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="side-bot-name" title={bot.name}>{bot.name}</div>
          <div className="side-bot-status">{readyCount > 0 ? <><span className="live-dot" aria-hidden /> Live</> : "Needs knowledge"}</div>
        </div>
      </div>
      <nav className="side-links" aria-label="Bot sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => open(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <Icon name={t.icon} /> {t.label}
            {badge(t.id) !== null && <span className={`count${t.id === "leads" ? " hot" : ""}`}>{badge(t.id)}</span>}
          </button>
        ))}
      </nav>
    </>
  );

  const show = (t: Tab) => visited.has(t);

  return (
    <Shell subnav={subnav}>
      <div className="bot-hero" style={color ? ({ "--bot": color } as React.CSSProperties) : undefined}>
        <Link href="/bots" className="crumb small"><Icon name="back" size={14} /> All bots</Link>
        <div className="bot-hero-row">
          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
            {bot.avatarDataUrl
              ? <img className="bot-avatar lg" src={bot.avatarDataUrl} alt="" />
              : <span className="bot-avatar lg" aria-hidden style={color ? { background: color } : undefined}>{bot.name.slice(0, 1).toUpperCase()}</span>}
            <div style={{ minWidth: 0 }}>
              <h1>{bot.name}</h1>
              <p className="muted" style={{ margin: 0 }}>
                {readyCount > 0 ? <span className="pill-live"><span className="live-dot" aria-hidden /> Answering</span> : <span className="pill-wait">Needs knowledge</span>}{" "}
                {readyCount} of {list.length} document{list.length === 1 ? "" : "s"} ready
              </p>
            </div>
          </div>
          {/* left, next to the name: on the right the open chat panel would cover it */}
          <button className={`btn glow${preview ? " secondary" : ""}`} onClick={() => setPreview((p) => !p)} disabled={readyCount === 0}
            title={readyCount === 0 ? "Upload a document first" : ""}>
            <Icon name={preview ? "close" : "play"} size={16} /> {preview ? "Close preview" : "Test your bot"}
          </button>
        </div>
        <div className="tabstrip" role="tablist" aria-label="Bot sections (phone)">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => open(t.id)}>
              <Icon name={t.icon} size={15} /> {t.label}
              {badge(t.id) !== null && <span className="count">{badge(t.id)}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert ok toast" role="status">{notice}</div>}
      {preview && (
        <div className="alert ok" role="status">
          Preview is on: use the chat bubble in the bottom corner, exactly as visitors will.
        </div>
      )}

      {/* ---------- Overview ---------- */}
      {show("overview") && (
        <div className="view" hidden={tab !== "overview"}>
          <div className="stats stagger">
            <button className="stat link" onClick={() => open("knowledge")}>
              <div className="label"><Icon name="layers" size={14} /> Sources</div>
              <div className="value"><CountUp value={list.length} /></div>
              <div className="hint">{readyCount} ready to answer</div>
            </button>
            <button className="stat link" onClick={() => open("knowledge")}>
              <div className="label"><Icon name="book" size={14} /> Knowledge pieces</div>
              <div className="value"><CountUp value={chunks} /></div>
              <div className="hint">searched for every question</div>
            </button>
            <button className="stat link" onClick={() => open("leads")}>
              <div className="label"><Icon name="users" size={14} /> New leads</div>
              <div className="value"><CountUp value={newLeads} /></div>
              <div className="hint">{bot.leadCaptureEnabled ? "waiting for your call" : "lead capture is off"}</div>
            </button>
            <button className="stat link" onClick={() => open("apps")}>
              <div className="label"><Icon name="apps" size={14} /> Messaging apps</div>
              <div className="value"><CountUp value={channels} /></div>
              <div className="hint">{channels ? "connected" : "WhatsApp, Instagram, Telegram"}</div>
            </button>
          </div>

          <div className="overview-grid">
            <section className="card setup">
              <div className="setup-head">
                <Ring done={doneCount} total={steps.length} />
                <div>
                  <h2>{doneCount === steps.length ? "All set. Your assistant is working for you." : "Get your assistant ready"}</h2>
                  <p className="muted small" style={{ margin: 0 }}>
                    {doneCount === steps.length ? "Keep your documents up to date when prices or timings change." : "Most owners finish these in about 10 minutes."}
                  </p>
                </div>
              </div>
              <ol className="steps-list stagger">
                {steps.map((s) => (
                  <li key={s.label} className={s.done ? "done" : ""}>
                    <span className="step-check" aria-hidden>{s.done ? <Icon name="check" size={14} /> : null}</span>
                    <div className="step-text">
                      <strong>{s.label}</strong>
                      <span className="muted small">{s.hint}</span>
                    </div>
                    {!s.done && <button className="btn secondary small" onClick={() => open(s.tab)}>{s.cta} <Icon name="arrow" size={14} /></button>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="card phone-card" aria-label="How visitors see it">
              <div className="muted small" style={{ fontWeight: 700, marginBottom: 12 }}>How visitors see it</div>
              <div className="mini-widget" style={color ? ({ "--w": color } as React.CSSProperties) : undefined}>
                <div className="mini-head">
                  {bot.avatarDataUrl ? <img src={bot.avatarDataUrl} alt="" /> : <span>{bot.name.slice(0, 1).toUpperCase()}</span>}
                  <div><strong>{bot.name}</strong><small>Online · replies instantly</small></div>
                </div>
                <div className="mini-body">
                  <div className="mini-msg">{bot.welcomeMessage || "Hi! How can I help you today?"}</div>
                  {bot.suggestedQuestions.length > 0 && (
                    <div className="mini-chips">{bot.suggestedQuestions.slice(0, 3).map((q) => <span key={q}>{q}</span>)}</div>
                  )}
                  <div className="mini-typing" aria-hidden><i /><i /><i /></div>
                </div>
                <div className="mini-input">Type your question…</div>
              </div>
              <button className="btn block" style={{ marginTop: 14 }} onClick={() => open("answers")} disabled={readyCount === 0}>
                <Icon name="flask" size={16} /> Try it in the playground
              </button>
            </section>
          </div>
        </div>
      )}

      {/* ---------- Knowledge ---------- */}
      {show("knowledge") && (
        <div className="view" hidden={tab !== "knowledge"}>
          <div className="split">
            <section className="card" id="knowledge">
              <div className="card-head">
                <div className="section-title"><span className="section-icon" aria-hidden><Icon name="upload" /></span><h2>Add knowledge</h2></div>
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
                    <span className="drop-icon" aria-hidden><Icon name="upload" size={26} /></span>
                    <strong>Drop files here</strong> or click to choose
                    <div className="small">PDF, Word, Excel, CSV, TXT or Markdown · up to 10 MB each</div>
                  </>
                )}
              </div>
              <input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} hidden
                aria-label="Upload documents" onChange={(e) => e.target.files && upload(e.target.files)} />

              <div className="or-divider"><span>or add from the web</span></div>
              <AddSource botId={id} onAdded={() => { void loadDocs(); flash("Added. Reading it now, this can take a minute."); }} />
            </section>

            <section className="card">
              <div className="card-head">
                <div className="section-title"><span className="section-icon" aria-hidden><Icon name="layers" /></span><h2>Your sources</h2></div>
                <span className="muted small">The bot answers only from these</span>
              </div>
              {list.length === 0 && !uploading ? (
                <div className="empty-state">
                  <div className="empty-art" aria-hidden><Icon name="book" size={30} /></div>
                  <strong>No knowledge yet</strong>
                  <p className="muted small">Brochures, fee lists, timings and FAQs work best.</p>
                  <a className="btn secondary small" href="/samples/sunrise-academy.txt" download>Try a sample document</a>
                </div>
              ) : (
                <ul className="source-list stagger">
                  {list.map((d) => (
                    <li key={d.id} className="source-item">
                      <span className={`file-icon k-${d.kind}`} aria-hidden>{KIND_LABEL[d.kind] ?? d.fileName.split(".").pop()?.slice(0, 4).toUpperCase()}</span>
                      <div className="source-main">
                        <div className="source-name">{d.fileName}</div>
                        {d.sourceUrl && (
                          <div className="small muted source-url">
                            <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">{d.sourceUrl.replace(/^https?:\/\//, "")}</a>
                          </div>
                        )}
                        <div className="source-meta">
                          <StatusBadge doc={d} />
                          {d.kind === "file" ? <span className="muted small">{formatSize(d.sizeBytes)}</span> : (
                            <>
                              <select className="status-select" value={d.syncIntervalDays} onChange={(e) => void setSync(d, Number(e.target.value))}
                                aria-label={`Updates for ${d.fileName}`}>
                                {SYNC_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
                              </select>
                              <span className="muted small">Last read: {when(d.lastSyncedAt)}</span>
                            </>
                          )}
                        </div>
                        {d.status === "Failed" && d.error && <div className="small" style={{ color: "var(--danger)" }}>{d.error}</div>}
                      </div>
                      <div className="source-actions">
                        {(d.status === "Failed" || d.status === "UploadedUnqueued") && d.kind === "file" && (
                          <button className="btn secondary small" onClick={() => reprocess(d)}>Retry</button>
                        )}
                        {d.kind !== "file" && d.status !== "Uploaded" && (
                          <button className="btn secondary small" onClick={() => reprocess(d)}>Sync now</button>
                        )}
                        <button className="btn danger small" onClick={() => removeDoc(d)} aria-label={`Delete ${d.fileName}`}>
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ---------- Test & answers ---------- */}
      {show("answers") && (
        <div className="view" hidden={tab !== "answers"}>
          <div className="split">
            <Playground publicKey={bot.publicKey} ready={readyCount > 0} onCorrect={correct} onAsked={tested} />
            <QaSection botId={id} draft={draft} onDraftUsed={clearDraft} />
          </div>
        </div>
      )}

      {show("leads") && (
        <div className="view" hidden={tab !== "leads"} id="leads">
          <LeadsSection botId={id} enabled={bot.leadCaptureEnabled} />
        </div>
      )}

      {show("conversations") && (
        <div className="view" hidden={tab !== "conversations"}>
          <ConversationsSection botId={id} onCorrect={correct} />
        </div>
      )}

      {show("apps") && (
        <div className="view" hidden={tab !== "apps"}>
          <ChannelsSection botId={id} />
        </div>
      )}

      {/* ---------- Install ---------- */}
      {show("install") && (
        <div className="view" hidden={tab !== "install"}>
          <section className="card" id="install">
            <div className="card-head">
              <div className="section-title"><span className="section-icon" aria-hidden><Icon name="code" /></span><h2>Add to your website</h2></div>
            </div>
            <p className="muted">
              Paste this one line just before the closing <code>&lt;/body&gt;</code> tag of your site. Colour, side and logo come from{" "}
              <button className="link-btn" onClick={() => open("settings")}>Settings</button>, so you never need to change this code.
            </p>
            <div className="snippet-wrap">
              <pre className="snippet" data-testid="embed-snippet">{snippet}</pre>
              <button className={`btn small copy-btn${copied ? " copied" : ""}`} onClick={copySnippet}>
                {copied ? <><Icon name="check" size={14} /> Copied!</> : "Copy snippet"}
              </button>
            </div>
            <div className="install-grid stagger">
              <div className="install-step"><strong>WordPress</strong><span>Appearance → Theme File Editor → footer.php, or any “header &amp; footer scripts” plugin.</span></div>
              <div className="install-step"><strong>Wix</strong><span>Settings → Custom code → Add code → Body - end → all pages.</span></div>
              <div className="install-step"><strong>Shopify</strong><span>Online Store → Themes → Edit code → theme.liquid, before &lt;/body&gt;.</span></div>
              <div className="install-step"><strong>Any other site</strong><span>Send the line to your web developer; it takes them a minute.</span></div>
            </div>
          </section>
        </div>
      )}

      {/* ---------- Settings ---------- */}
      {show("settings") && (
        <div className="view" hidden={tab !== "settings"}>
          <SettingsForm key={bot.id} bot={bot} onSaved={(b, message) => { setBot(b); flash(message); }} />
          <section className="card danger-zone" id="danger">
            <h2>Danger zone</h2>
            <p className="muted small">Deleting the bot removes its documents and stops the widget on every site using it.</p>
            <button className="btn danger" onClick={removeBot}>Delete bot</button>
          </section>
        </div>
      )}
    </Shell>
  );
}

export default function BotPage() {
  const params = useParams<{ id: string }>();
  return <BotDetail id={params.id} />;
}
