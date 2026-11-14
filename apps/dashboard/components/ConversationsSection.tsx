"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { api, Conversation, ConversationSummary } from "@/lib/api";

export const CHANNEL_ICON: Record<string, string> = { web: "🌐", whatsapp: "🟢", instagram: "📸", messenger: "💬", telegram: "✈️" };

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Every visitor chat with this bot, newest first; unanswered questions are marked so the owner can fill the gaps. */
export default function ConversationsSection({ botId, onCorrect }: { botId: string; onCorrect?: (question: string, answer: string) => void }) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await api.listConversations(botId);
      setItems(page);
      setMore(page.length === 20);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!items?.length) return;
    try {
      const page = await api.listConversations(botId, items[items.length - 1].lastMessageAt);
      setItems([...items, ...page]);
      setMore(page.length === 20);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setThread(null);
    try {
      setThread(await api.getConversation(botId, id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this conversation? Use this when a visitor asks for their chat to be removed.")) return;
    try {
      await api.deleteConversation(botId, id);
      setItems((xs) => xs?.filter((x) => x.id !== id) ?? null);
      setOpen(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const shown = items?.filter((c) => !onlyUnanswered || c.unansweredCount > 0) ?? null;
  const gaps = items?.reduce((n, c) => n + c.unansweredCount, 0) ?? 0;

  return (
    <section className="card" aria-label="Conversations" id="conversations">
      <div className="card-head">
        <div className="section-title"><span className="section-icon" aria-hidden>💬</span><h2>Conversations</h2></div>
        <div className="row">
          {gaps > 0 && (
            <label className="check small" style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={onlyUnanswered} onChange={(e) => setOnlyUnanswered(e.target.checked)} />
              Only unanswered ({gaps})
            </label>
          )}
          <button className="btn secondary small" onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {gaps > 0 && (
        <p className="small muted">
          Questions marked <span className="badge processing">not in documents</span> could not be answered. Add that information to a document and upload it.
        </p>
      )}

      {shown === null ? (
        <span className="spinner" aria-label="Loading" />
      ) : shown.length === 0 ? (
        <p className="empty small" style={{ padding: 16 }}>
          {onlyUnanswered ? "No unanswered questions." : "No conversations yet. They appear here as soon as visitors chat with your bot."}
        </p>
      ) : (
        <div className="convo-list">
          {shown.map((c) => (
            <Fragment key={c.id}>
              <button className="convo-item" aria-expanded={open === c.id} onClick={() => void toggle(c.id)}>
                <span className="q">
                  <span aria-label={c.channel} title={c.channel}>{CHANNEL_ICON[c.channel] ?? "🌐"}</span>{" "}
                  {c.contactName && <strong>{c.contactName}: </strong>}{c.firstQuestion ?? "(no question)"}
                </span>
                <span className="meta">{when(c.lastMessageAt)}</span>
                <span className="meta">
                  {c.messageCount / 2} question{c.messageCount === 2 ? "" : "s"}
                  {c.unansweredCount > 0 && <> · <span style={{ color: "var(--warn)" }}>{c.unansweredCount} unanswered</span></>}
                  {c.pageUrl && <> · {c.pageUrl.replace(/^https?:\/\//, "")}</>}
                </span>
              </button>
              {open === c.id && (
                <div className="thread">
                  {!thread ? (
                    <span className="spinner" aria-label="Loading" />
                  ) : (
                    <>
                      {thread.messages.map((m, i) => (
                        <div key={i} className={`bubble ${m.role === "user" ? "user" : "bot"}${m.role === "user" && !m.answered ? " unanswered" : ""}`}>
                          {m.text}
                          {m.role === "user" && !m.answered && (
                            <span className="unanswered-tag">not in documents</span>
                          )}
                          {m.role === "assistant" && onCorrect && i > 0 && (
                            <button className="link-btn correct-btn" onClick={() => onCorrect(thread.messages[i - 1].text, m.text)}>
                              Correct this answer
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn danger small" onClick={() => void remove(c.id)}>Delete conversation</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </Fragment>
          ))}
          {more && !onlyUnanswered && <button className="btn secondary small" onClick={() => void loadMore()}>Load older</button>}
        </div>
      )}
    </section>
  );
}
