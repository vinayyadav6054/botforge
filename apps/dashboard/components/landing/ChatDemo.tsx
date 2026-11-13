"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { DemoQA, DemoScenario, SCENARIOS } from "@/lib/demo-scenarios";

type Msg =
  | { kind: "bot"; text: string; doc?: string }
  | { kind: "user"; text: string }
  | { kind: "lead"; done: boolean };

interface Lead {
  name: string;
  phone: string;
  interest: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const STOP = new Set("a an the is are do does you your i me my can what when how much there for of to in on at and it this".split(" "));
function words(s: string) {
  return s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) ?? [];
}

/** The scripted answer whose question shares the most meaningful words with the visitor's text. */
function bestMatch(text: string, qa: DemoQA[]): DemoQA | null {
  const t = new Set(words(text));
  let best: DemoQA | null = null;
  let score = 0;
  for (const item of qa) {
    const s = words(item.q + " " + item.a).filter((w) => t.has(w)).length;
    if (s > score) [best, score] = [item, s];
  }
  return score > 0 ? best : null;
}

/**
 * Interactive, scripted demo: documents on the left, the chat in the middle and the owner's lead inbox on the
 * right, so a visitor sees the whole flow (knowledge -> answer -> enquiry) in a few seconds.
 */
export default function ChatDemo({ initial = "coaching", compact = false }: { initial?: string; compact?: boolean }) {
  const [scenario, setScenario] = useState<DemoScenario>(SCENARIOS.find((s) => s.id === initial) ?? SCENARIOS[0]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [started, setStarted] = useState(false);
  const run = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [msgs, typing]);

  const answer = useCallback(async (token: number, qa: DemoQA | null, question: string, sc: DemoScenario) => {
    const alive = () => run.current === token;
    setMsgs((m) => [...m, { kind: "user", text: question }]);
    if (qa) setAsked((a) => [...a, qa.q]);
    setTyping(true);
    if (qa) setReading(qa.doc);
    await sleep(reducedMotion() ? 0 : 1100);
    if (!alive()) return false;
    setTyping(false);
    const full = qa
      ? qa.a
      : `In this demo I only know ${sc.business}'s sample documents. Create your free bot to try it with your own!`;
    if (reducedMotion()) {
      setMsgs((m) => [...m, { kind: "bot", text: full, doc: qa?.doc }]);
    } else {
      setMsgs((m) => [...m, { kind: "bot", text: "", doc: qa?.doc }]);
      for (let i = 3; i < full.length + 3; i += 3) {
        await sleep(16);
        if (!alive()) return false;
        const text = full.slice(0, i);
        setMsgs((m) => [...m.slice(0, -1), { kind: "bot", text, doc: qa?.doc }]);
      }
    }
    setReading(null);
    return true;
  }, []);

  const captureLead = useCallback(async (token: number, sc: DemoScenario) => {
    const alive = () => run.current === token;
    setMsgs((m) => [...m, { kind: "lead", done: false }]);
    await sleep(reducedMotion() ? 0 : 1600);
    if (!alive()) return;
    setMsgs((m) => m.map((x) => (x.kind === "lead" ? { kind: "lead", done: true } : x)));
    await sleep(reducedMotion() ? 0 : 500);
    if (!alive()) return;
    setLeads((l) => (l.some((x) => x.name === sc.lead.name) ? l : [sc.lead, ...l]));
  }, []);

  const play = useCallback(async (sc: DemoScenario) => {
    const token = ++run.current;
    setMsgs([{ kind: "bot", text: sc.welcome }]);
    setAsked([]);
    setLeads([]);
    setTyping(false);
    setReading(null);
    setBusy(true);
    const steps = compact ? sc.qa.slice(0, 1) : sc.qa.slice(0, 2);
    for (const qa of steps) {
      await sleep(reducedMotion() ? 0 : 900);
      if (run.current !== token) return;
      if (!(await answer(token, qa, qa.q, sc))) return;
    }
    if (!compact) {
      await sleep(reducedMotion() ? 0 : 700);
      if (run.current !== token) return;
      await captureLead(token, sc);
    }
    if (run.current === token) setBusy(false);
  }, [answer, captureLead, compact]);

  // start playing when the demo scrolls into view
  useEffect(() => {
    const el = root.current;
    if (!el || started) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setStarted(true);
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (started) void play(scenario);
    return () => {
      run.current++;
    };
  }, [started, scenario, play]);

  async function ask(question: string, qa: DemoQA | null) {
    if (busy || !question.trim()) return;
    const token = ++run.current;
    setBusy(true);
    await answer(token, qa, question.trim(), scenario);
    if (run.current === token) setBusy(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input;
    setInput("");
    void ask(text, bestMatch(text, scenario.qa));
  }

  const remaining = scenario.qa.filter((x) => !asked.includes(x.q));

  return (
    <div className={`demo${compact ? " demo-compact" : ""}`} ref={root}>
      {!compact && (
        <div className="demo-tabs" role="tablist" aria-label="Choose a business">
          {SCENARIOS.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === scenario.id}
              className={`demo-tab${s.id === scenario.id ? " active" : ""}`}
              onClick={() => { setStarted(true); setScenario(s); }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="demo-stage">
        {!compact && (
          <aside className="demo-panel demo-docs" aria-label="Documents the bot learned from">
            <div className="demo-panel-head">
              <span className="dot" /> Knowledge
            </div>
            <ul>
              {scenario.docs.map((d) => (
                <li key={d} className={reading === d ? "reading" : ""}>
                  <span className="file-icon" aria-hidden>{d.split(".").pop()}</span>
                  <span className="file-name">{d}</span>
                  {reading === d && <span className="reading-tag">reading…</span>}
                </li>
              ))}
            </ul>
            <p className="demo-note">Answers come only from these files.</p>
          </aside>
        )}

        <div className="demo-chat" aria-label={`Chat with ${scenario.botName}`}>
          <div className="demo-chat-head">
            <span className="avatar" aria-hidden>{scenario.business.slice(0, 1)}</span>
            <div>
              <strong>{scenario.botName}</strong>
              <span className="online">Online · replies instantly</span>
            </div>
          </div>
          <div className="demo-log" ref={log} aria-live="polite">
            {msgs.map((m, i) =>
              m.kind === "lead" ? (
                <div key={i} className="demo-lead-form">
                  <div className="lead-title">Want a call back from {scenario.business}?</div>
                  <div className="lead-field"><span>Name</span>{scenario.lead.name}</div>
                  <div className="lead-field"><span>Phone</span>{scenario.lead.phone}</div>
                  <div className={`lead-submit${m.done ? " done" : ""}`}>{m.done ? "✓ Request sent" : "Sending…"}</div>
                </div>
              ) : (
                <div key={i} className={`bubble ${m.kind}`}>
                  {m.text}
                  {m.kind === "bot" && m.doc && m.text && !compact && <span className="bubble-src">{m.doc}</span>}
                </div>
              ),
            )}
            {typing && (
              <div className="bubble bot typing" aria-label="Typing">
                <i /><i /><i />
              </div>
            )}
          </div>
          {remaining.length > 0 && (
            <div className="demo-chips">
              {remaining.map((qa) => (
                <button key={qa.q} className="chip" disabled={busy} onClick={() => { setStarted(true); void ask(qa.q, qa); }}>
                  {qa.q}
                </button>
              ))}
            </div>
          )}
          <form className="demo-input" onSubmit={onSubmit}>
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a question…"
              aria-label="Demo message" maxLength={200} />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send demo message">↑</button>
          </form>
        </div>

        {!compact && (
          <aside className="demo-panel demo-inbox" aria-label="Owner's lead inbox">
            <div className="demo-panel-head">
              <span className="dot live" /> Your leads
            </div>
            {leads.length === 0 ? (
              <p className="demo-note">New enquiries appear here, with their chat attached.</p>
            ) : (
              leads.map((l) => (
                <div key={l.name} className="lead-card">
                  <div className="lead-card-top">
                    <strong>{l.name}</strong>
                    <span className="badge processing">New</span>
                  </div>
                  <div className="small muted">{l.phone}</div>
                  <div className="small">{l.interest}</div>
                  <div className="lead-actions">
                    <span className="mini-btn wa">WhatsApp</span>
                    <span className="mini-btn">Call</span>
                  </div>
                </div>
              ))
            )}
          </aside>
        )}
      </div>

      {!compact && (
        <div className="demo-foot">
          <button className="btn ghost small" onClick={() => { setStarted(true); void play(scenario); }}>↻ Replay</button>
          <span className="muted small">Scripted preview. Your bot answers from your own documents.</span>
        </div>
      )}
    </div>
  );
}
