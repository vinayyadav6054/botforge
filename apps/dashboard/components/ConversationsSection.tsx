"use client";

import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, Conversation, ConversationSummary } from "@/lib/api";
import Icon from "@/components/Icon";
import { AnimatedList } from "@/components/AppMotion";

export const CHANNEL_ICON: Record<string, string> = { web: "🌐", whatsapp: "🟢", instagram: "📸", messenger: "💬", telegram: "✈️" };
const CHANNEL_NAME: Record<string, string> = { web: "website", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", telegram: "Telegram" };
const LIVE_MINUTES = 5;

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const isLive = (c: { lastMessageAt: string }) => Date.now() - new Date(c.lastMessageAt).getTime() < LIVE_MINUTES * 60_000;

/** True while the browser tab is visible: no point checking for messages nobody sees. */
function useVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * Every visitor chat with this bot, newest first, refreshed live. The owner can take over a chat and reply
 * themselves (the bot pauses), on the website and in messaging apps; unanswered questions are marked.
 */
export default function ConversationsSection({ botId, onCorrect }: { botId: string; onCorrect?: (question: string, answer: string) => void }) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const visible = useVisible();
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const load = useCallback(async () => {
    try {
      const page = await api.listConversations(botId);
      // keep pages loaded with "Load older"
      setItems((old) => (old && old.length > page.length ? [...page, ...old.filter((o) => !page.some((p) => p.id === o.id))] : page));
      setMore((m) => m || page.length === 20);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  const loadThread = useCallback(async (id: string) => {
    try {
      const t = await api.getConversation(botId, id);
      setThread((old) => (old?.id === id || old === null ? t : old));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  // live: the list every 15 s, the open chat every 4 s (only while the tab is visible)
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [visible, load]);
  useEffect(() => {
    if (!visible || !open) return;
    const t = setInterval(() => void loadThread(open), 4_000);
    return () => clearInterval(t);
  }, [visible, open, loadThread]);

  // scroll to the newest message when new ones arrive
  useEffect(() => {
    const n = thread?.messages.length ?? 0;
    if (n > seen.current) bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    seen.current = n;
  }, [thread]);

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
    setReply("");
    seen.current = 0;
    await loadThread(id);
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

  async function setHuman(id: string, on: boolean) {
    setSwitching(true);
    try {
      if (on) await api.takeOver(botId, id);
      else await api.handBack(botId, id);
      await Promise.all([loadThread(id), load()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!open || !reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.reply(botId, open, reply.trim());
      setReply("");
      await Promise.all([loadThread(open), load()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const shown = items?.filter((c) => !onlyUnanswered || c.unansweredCount > 0) ?? null;
  const gaps = items?.reduce((n, c) => n + c.unansweredCount, 0) ?? 0;
  const live = items?.filter(isLive).length ?? 0;

  return (
    <section className="card" aria-label="Conversations" id="conversations">
      <div className="card-head">
        <div className="section-title">
          <span className="section-icon" aria-hidden><Icon name="chat" /></span><h2>Conversations</h2>
          {live > 0 && <span className="pill-live"><span className="live-dot" aria-hidden /> {live} live now</span>}
        </div>
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
      <p className="small muted" style={{ marginTop: -4 }}>
        Open a chat to read it. <strong>Take over</strong> to reply yourself: the bot stays quiet in that chat until you hand it back
        (or 2 hours after your last reply).
      </p>
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
        <AnimatedList className="convo-list">
          {shown.map((c) => (
            <Fragment key={c.id}>
              <button className={`convo-item${c.human ? " is-human" : ""}`} aria-expanded={open === c.id} onClick={() => void toggle(c.id)}>
                <span className="q">
                  <span aria-label={c.channel} title={c.channel}>{CHANNEL_ICON[c.channel] ?? "🌐"}</span>{" "}
                  {isLive(c) && <span className="live-dot" title="Active in the last few minutes" aria-label="live" />}{" "}
                  {c.contactName && <strong>{c.contactName}: </strong>}{c.firstQuestion ?? "(no question)"}
                </span>
                <span className="meta">
                  {c.human && <span className="badge ready" style={{ marginRight: 6 }}>You are replying</span>}
                  {when(c.lastMessageAt)}
                </span>
                <span className="meta">
                  {c.messageCount} message{c.messageCount === 1 ? "" : "s"}
                  {c.unansweredCount > 0 && <> · <span style={{ color: "var(--warn)" }}>{c.unansweredCount} unanswered</span></>}
                  {c.pageUrl && <> · {c.pageUrl.replace(/^https?:\/\//, "")}</>}
                </span>
              </button>
              {open === c.id && (
                <div className="thread">
                  {!thread || thread.id !== c.id ? (
                    <span className="spinner" aria-label="Loading" />
                  ) : (
                    <>
                      <div className={`handover-bar${thread.human ? " on" : ""}`}>
                        {thread.human ? (
                          <>
                            <span><strong>You are replying.</strong> The bot is paused in this chat
                              {thread.humanUntil ? ` until ${time(thread.humanUntil)} unless you reply again` : ""}.</span>
                            <button className="btn secondary small" disabled={switching} onClick={() => void setHuman(c.id, false)}>
                              <Icon name="bots" size={14} /> Hand back to bot
                            </button>
                          </>
                        ) : (
                          <>
                            <span>The bot is answering this chat.</span>
                            <button className="btn small" disabled={switching} onClick={() => void setHuman(c.id, true)}>
                              <Icon name="users" size={14} /> Take over
                            </button>
                          </>
                        )}
                      </div>
                      {thread.messages.map((m, i) => (
                        <div key={i} className={`bubble ${m.role === "user" ? "user" : "bot"}${m.role === "agent" ? " agent" : ""}${m.role === "user" && !m.answered ? " unanswered" : ""}`}>
                          {m.role === "agent" && <span className="agent-tag">You</span>}
                          {m.text}
                          {m.role === "user" && !m.answered && (
                            <span className="unanswered-tag">not in documents</span>
                          )}
                          {m.role === "assistant" && onCorrect && i > 0 && thread.messages[i - 1].role === "user" && (
                            <button className="link-btn correct-btn" onClick={() => onCorrect(thread.messages[i - 1].text, m.text)}>
                              Correct this answer
                            </button>
                          )}
                        </div>
                      ))}
                      <div ref={bottom} />
                      <form className="reply-box" onSubmit={send} aria-label="Reply">
                        <textarea value={reply} maxLength={2000} rows={2} onChange={(e) => setReply(e.target.value)}
                          placeholder={`Reply on ${CHANNEL_NAME[thread.channel] ?? "the website"} as yourself…`} aria-label="Your reply"
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
                        <button className="btn" type="submit" disabled={sending || !reply.trim()}>{sending ? "Sending…" : "Send"}</button>
                      </form>
                      <p className="small muted" style={{ margin: "4px 0 0" }}>
                        {thread.channel === "web"
                          ? "The visitor sees your reply in the chat window within a few seconds, if it is still open."
                          : thread.channel === "whatsapp"
                            ? "Sent from your WhatsApp number. WhatsApp allows replies within 24 hours of the customer's last message."
                            : `Sent through ${CHANNEL_NAME[thread.channel]}.`}
                        {" "}Sending a reply takes over the chat.
                      </p>
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
        </AnimatedList>
      )}
    </section>
  );
}
