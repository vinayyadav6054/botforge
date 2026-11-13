"use client";

import { FormEvent, useState } from "react";
import { api, SourceKind } from "@/lib/api";

const KINDS: { id: SourceKind; label: string; icon: string; placeholder: string; help: string }[] = [
  {
    id: "website", label: "Website", icon: "🌐", placeholder: "https://www.yourbusiness.com",
    help: "We read your website's pages (up to your plan's page limit), following links on the same site.",
  },
  {
    id: "google", label: "Google Docs / Sheets", icon: "📗", placeholder: "https://docs.google.com/document/d/…",
    help: "Docs, Sheets, Slides or a Drive file (PDF, Word, Excel). In Google, set Share → General access → \"Anyone with the link\".",
  },
  {
    id: "notion", label: "Notion", icon: "📓", placeholder: "https://www.notion.so/Your-page-…",
    help: "Create an integration at notion.so/my-integrations, copy its secret, then open your page → ••• → Connections → add the integration.",
  },
  {
    id: "youtube", label: "YouTube", icon: "▶️", placeholder: "https://www.youtube.com/watch?v=…",
    help: "We read the video's captions (automatic captions work too). Answers link to the right moment in the video.",
  },
];

export const SYNC_OPTIONS = [
  { days: 0, label: "Only when I click Sync" },
  { days: 1, label: "Every day" },
  { days: 7, label: "Every week" },
  { days: 30, label: "Every month" },
];

/** Adds a website, Google file, Notion page or YouTube video as knowledge. */
export default function AddSource({ botId, onAdded }: { botId: string; onAdded: () => void }) {
  const [kind, setKind] = useState<SourceKind>("website");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [sync, setSync] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = KINDS.find((k) => k.id === kind)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addSource(botId, { kind, url: url.trim(), token: kind === "notion" ? token.trim() : undefined,
        syncIntervalDays: kind === "youtube" ? 0 : sync });
      setUrl("");
      setToken("");
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="add-source" aria-label="Add an online source">
      <div className="source-tabs" role="tablist" aria-label="Source type">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id}
            className={`source-tab${kind === k.id ? " active" : ""}`} onClick={() => { setKind(k.id); setError(null); }}>
            <span aria-hidden>{k.icon}</span> {k.label}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: "10px 0" }}>{current.help}</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="source-row">
        <input type="text" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder={current.placeholder} aria-label={`${current.label} address`} />
        {kind === "notion" && (
          <input type="password" required value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="Integration secret (ntn_…)" aria-label="Notion integration secret" autoComplete="off" />
        )}
        {kind !== "youtube" && (
          <select className="status-select" value={sync} onChange={(e) => setSync(Number(e.target.value))} aria-label="Update">
            {SYNC_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
          </select>
        )}
        <button className="btn" type="submit" disabled={busy || !url.trim()}>{busy ? "Adding…" : "Add"}</button>
      </div>
    </form>
  );
}
