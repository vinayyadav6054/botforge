"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";

const TOPICS = ["Help setting up", "Billing and payment", "WhatsApp or other apps", "Something is not working", "Feature idea", "Other"];

/** "Message us": goes to the Kahiye team by email; the reply comes to the owner's email address. */
export default function SupportForm() {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");

  async function send(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      await api.support(topic, message.trim());
      setMessage("");
      setState("sent");
    } catch (err) {
      setState((err as Error).message);
    }
  }

  return (
    <section className="card" id="support" aria-label="Support">
      <h2>Need help? Message us</h2>
      <p className="muted small">We reply to your account email within one working day. We can also set things up for you.</p>
      {state === "sent" && <div className="alert ok" role="status">Sent! We will reply to your email soon.</div>}
      {state !== "idle" && state !== "sending" && state !== "sent" && <div className="alert error" role="alert">{state}</div>}
      <form onSubmit={send}>
        <div className="field">
          <label htmlFor="supportTopic">What is it about?</label>
          <select id="supportTopic" className="status-select wide" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="supportMessage">Your message</label>
          <textarea id="supportMessage" required minLength={10} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what you need. For payments, include your UPI reference number." />
        </div>
        <button className="btn" type="submit" disabled={state === "sending" || message.trim().length < 10}>
          {state === "sending" ? "Sending…" : "Send message"}
        </button>
      </form>
    </section>
  );
}
