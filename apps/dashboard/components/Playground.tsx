"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { playgroundAsk, SourceRef } from "@/lib/api";

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: SourceRef[];
  matched?: number;
  error?: boolean;
}

/**
 * Test chat inside the dashboard: the same answers visitors get, plus where each one came from.
 * Not saved as a visitor conversation; answers still count towards the monthly limit.
 */
export default function Playground({ publicKey, ready, onCorrect }: {
  publicKey: string;
  ready: boolean;
  onCorrect: (question: string, answer: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = turns.filter((t) => !t.error).slice(-10).map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: "user", text: q }, { role: "assistant", text: "" }]);
    const update = (fn: (t: Turn) => Turn) => setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      await playgroundAsk(publicKey, q, history, {
        onToken: (text) => update((t) => ({ ...t, text: t.text + text })),
        onSources: (sources) => update((t) => ({ ...t, sources })),
        onMeta: (m) => update((t) => ({ ...t, matched: m.sources })),
      });
    } catch (err) {
      update((t) => ({ ...t, text: (err as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="playground" aria-label="Playground">
      <div className="card-head">
        <div className="section-title"><span className="section-icon" aria-hidden>🧪</span><h2>Playground</h2></div>
        {turns.length > 0 && <button className="btn secondary small" onClick={() => setTurns([])}>Clear</button>}
      </div>
      <p className="small muted">
        Ask what your customers would ask. You see where each answer came from; if one is wrong, correct it in one click.
      </p>
      <div className="playground-log" ref={log} aria-live="polite">
        {turns.length === 0 && <p className="muted small" style={{ margin: "auto", textAlign: "center" }}>{ready ? "Try: “What are your fees?”" : "Upload a document first."}</p>}
        {turns.map((t, i) => (
          <div key={i} className={`pg-turn ${t.role}`}>
            <div className={`bubble ${t.role === "user" ? "user" : "bot"}`}>
              {t.text || <span className="typing-dots"><i /><i /><i /></span>}
            </div>
            {t.role === "assistant" && t.text && !t.error && (
              <div className="pg-meta small muted">
                {t.sources?.length
                  ? <>From: {t.sources.map((s) => (s.location ? `${s.name} (${s.location})` : s.name)).join(" · ")}</>
                  : t.matched === 0 ? "Nothing in your documents matched this question." : "Based on your documents and answers."}
                {!busy && i === turns.length - 1 && (
                  <button className="link-btn" style={{ marginLeft: 10 }} onClick={() => onCorrect(turns[i - 1]?.text ?? "", t.text)}>
                    Correct this answer
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={ask} style={{ marginTop: 10, flexWrap: "nowrap" }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask your bot…"
          aria-label="Playground question" maxLength={1000} disabled={!ready} />
        <button className="btn" type="submit" disabled={busy || !ready || !input.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
    </section>
  );
}
