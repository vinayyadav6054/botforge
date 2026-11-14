"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, Bot } from "@/lib/api";
import { AnimatedList, Tilt } from "@/components/AppMotion";

function BotList() {
  const router = useRouter();
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [welcome, setWelcome] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listBots().then(setBots).catch((e: Error) => setError(e.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const bot = await api.createBot(name.trim(), welcome.trim());
      router.push(`/bots/${bot.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your bots</h1>
          <p className="muted" style={{ margin: 0 }}>Each bot answers questions from the documents you upload.</p>
        </div>
        {!showForm && bots !== null && (
          <button className="btn" onClick={() => setShowForm(true)}>
            + New bot
          </button>
        )}
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={create} aria-label="Create bot">
          <h2>New bot</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="botName">Name</label>
              <input id="botName" type="text" required maxLength={200} value={name}
                onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Academy Assistant" autoFocus />
            </div>
            <div className="field">
              <label htmlFor="welcome">Welcome message (optional)</label>
              <textarea id="welcome" maxLength={500} value={welcome} rows={2} style={{ minHeight: 44 }}
                onChange={(e) => setWelcome(e.target.value)} placeholder="Hi! How can I help you today?" />
            </div>
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating..." : "Create bot"}
            </button>
            <button className="btn secondary" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {bots === null && !error && <span className="spinner" aria-label="Loading" />}
      {bots?.length === 0 && !showForm && (
        <div className="welcome">
          <div>
            <p className="muted" style={{ marginBottom: 4 }}>You have no bots yet.</p>
            <h2>Let&apos;s build your first assistant.</h2>
            <ol>
              <li>Create a bot and give it a name</li>
              <li>Upload your brochure, price list or FAQ</li>
              <li>Test it, then paste one line on your website</li>
            </ol>
            <div className="row">
              <button className="btn" onClick={() => setShowForm(true)}>Create your first bot</button>
              <a className="btn ghost" href="/samples/sunrise-academy.txt" download>Download a sample document</a>
            </div>
          </div>
          <div className="welcome-art" aria-hidden>
            <div className="bubble user">What are the fees?</div>
            <div className="bubble bot">The JEE programme is ₹68,000 per year, payable in 3 instalments.</div>
            <div className="bubble user">Can someone call me?</div>
            <div className="bubble bot">Sure! Leave your name and number and we&apos;ll call you back.</div>
          </div>
        </div>
      )}
      {bots && bots.length > 0 && (
        <AnimatedList className="grid stagger">
          {bots.map((b) => (
            <Tilt key={b.id} className="tilt-wrap" max={5}>
            <Link href={`/bots/${b.id}`} className="card bot-card">
              <div className="bot-card-top">
                <span className="bot-avatar" aria-hidden>{initials(b.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <h3>{b.name}</h3>
                  <p className="muted small" style={{ margin: 0 }}>
                    Created {new Date(b.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {b.leadCaptureEnabled ? "Lead capture on" : "Lead capture off"}
                {b.suggestedQuestions?.length ? ` · ${b.suggestedQuestions.length} suggested questions` : ""}
              </p>
              <div className="bot-card-foot">
                <span className="small muted">{b.publicKey.slice(0, 10)}…</span>
                <span className="open">Open →</span>
              </div>
            </Link>
            </Tilt>
          ))}
          {!showForm && (
            <button className="new-card" onClick={() => setShowForm(true)} aria-label="Create another bot">
              <span className="plus">+</span>
              Another bot
            </button>
          )}
        </AnimatedList>
      )}
    </>
  );
}

function initials(name: string) {
  const w = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return w.slice(0, 2).map((x) => [...x][0]).join("").toUpperCase() || "B";
}

export default function BotsPage() {
  return (
    <Shell>
      <BotList />
    </Shell>
  );
}
