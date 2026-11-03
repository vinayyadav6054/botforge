"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, Bot } from "@/lib/api";

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
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            + New bot
          </button>
        )}
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={create} aria-label="Create bot">
          <h2>New bot</h2>
          <div className="field">
            <label htmlFor="botName">Name</label>
            <input id="botName" type="text" required maxLength={200} value={name}
              onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Assistant" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="welcome">Welcome message (optional)</label>
            <textarea id="welcome" maxLength={500} value={welcome}
              onChange={(e) => setWelcome(e.target.value)} placeholder="Hi! How can I help you today?" />
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
        <div className="card empty">
          <p>You have no bots yet.</p>
          <button className="btn" onClick={() => setShowForm(true)}>Create your first bot</button>
        </div>
      )}
      {bots && bots.length > 0 && (
        <div className="grid">
          {bots.map((b) => (
            <Link key={b.id} href={`/bots/${b.id}`} className="card bot-card">
              <h3>{b.name}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Created {new Date(b.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function BotsPage() {
  return (
    <Shell>
      <BotList />
    </Shell>
  );
}
