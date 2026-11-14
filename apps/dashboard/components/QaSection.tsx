"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, QaEntry, Unanswered } from "@/lib/api";
import Icon from "@/components/Icon";
import { AnimatedList } from "@/components/AppMotion";

export interface QaDraft {
  question: string;
  answer?: string;
  fromQuestion?: string;
}

/**
 * The owner's own answers (always used when a visitor asks something similar) and the questions the documents
 * could not answer, each with a one-click "Add answer".
 */
export default function QaSection({ botId, draft, onDraftUsed }: { botId: string; draft: QaDraft | null; onDraftUsed: () => void }) {
  const [items, setItems] = useState<QaEntry[] | null>(null);
  const [gaps, setGaps] = useState<Unanswered[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [fromQuestion, setFromQuestion] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [qa, unanswered] = await Promise.all([api.listQa(botId), api.listUnanswered(botId)]);
      setItems(qa);
      setGaps(unanswered);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback((id: string | "new", q = "", a = "", from?: string) => {
    setEditing(id);
    setQuestion(q);
    setAnswer(a);
    setFromQuestion(from);
    setError(null);
  }, []);

  // "Correct this answer" in Conversations sends a draft here
  useEffect(() => {
    if (!draft) return;
    open("new", draft.question, draft.answer ?? "", draft.fromQuestion);
    onDraftUsed();
    document.getElementById("answers")?.scrollIntoView({ behavior: "smooth" });
  }, [draft, onDraftUsed, open]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") await api.createQa(botId, question.trim(), answer.trim(), fromQuestion);
      else if (editing) await api.updateQa(botId, editing, question.trim(), answer.trim());
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(qa: QaEntry) {
    if (!confirm(`Delete the answer to "${qa.question}"?`)) return;
    await api.deleteQa(botId, qa.id).catch((e: Error) => setError(e.message));
    await load();
  }

  async function dismiss(q: string) {
    await api.dismissUnanswered(botId, q).catch((e: Error) => setError(e.message));
    await load();
  }

  const form = (
    <form className="qa-form" onSubmit={save} aria-label="Answer">
      <div className="field">
        <label htmlFor="qaQuestion">When a visitor asks</label>
        <input id="qaQuestion" type="text" required maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Do you have a hostel?" />
      </div>
      <div className="field">
        <label htmlFor="qaAnswer">The bot answers</label>
        <textarea id="qaAnswer" required maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder="e.g. Yes, our partner hostel is 5 minutes away and costs ₹9,000 a month including meals." />
      </div>
      <div className="row">
        <button className="btn small" type="submit" disabled={busy || !question.trim() || !answer.trim()}>{busy ? "Saving…" : "Save answer"}</button>
        <button className="btn secondary small" type="button" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </form>
  );

  return (
    <section className="card" id="answers" aria-label="Answers">
      <div className="card-head">
        <div className="section-title"><span className="section-icon" aria-hidden><Icon name="edit" /></span><h2>Your answers</h2></div>
        {editing === null && <button className="btn secondary small" onClick={() => open("new")}>+ Add answer</button>}
      </div>
      <p className="small muted">
        Write the exact answer for questions you get often, or fix an answer the bot got wrong. The bot prefers these over your documents.
      </p>
      {error && <div className="alert error" role="alert">{error}</div>}

      {gaps.length > 0 && (
        <div className="gaps">
          <h3 className="small" style={{ margin: "0 0 8px" }}>
            <span className="badge processing">{gaps.length}</span> Questions your documents don&apos;t answer yet
          </h3>
          {gaps.slice(0, 8).map((g) => (
            <div key={g.question} className="gap-row">
              <span className="gap-q">“{g.question}”{g.count > 1 && <span className="muted small"> · asked {g.count}×</span>}</span>
              <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <button className="btn small" onClick={() => open("new", g.question, "", g.question)}>Add answer</button>
                <button className="btn secondary small" onClick={() => void dismiss(g.question)} title="Remove from this list">Dismiss</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {editing === "new" && form}

      {items === null ? (
        <span className="spinner" aria-label="Loading" />
      ) : items.length === 0 && editing === null ? (
        <p className="empty small" style={{ padding: 12 }}>No answers yet.</p>
      ) : (
        <AnimatedList className="qa-list">
          {items.map((qa) =>
            editing === qa.id ? (
              <div key={qa.id}>{form}</div>
            ) : (
              <div key={qa.id} className="qa-item">
                <div>
                  <strong>{qa.question}</strong>
                  <p className="muted small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{qa.answer}</p>
                </div>
                <span className="row" style={{ gap: 6, flexWrap: "nowrap", alignSelf: "start" }}>
                  <button className="btn secondary small" onClick={() => open(qa.id, qa.question, qa.answer)}>Edit</button>
                  <button className="btn danger small" onClick={() => void remove(qa)} aria-label={`Delete answer ${qa.question}`}>Delete</button>
                </span>
              </div>
            ),
          )}
        </AnimatedList>
      )}
    </section>
  );
}
