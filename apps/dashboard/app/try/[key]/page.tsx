"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, gatewayOrigin } from "@/lib/api";
import { site, whatsappLink } from "@/lib/site";

interface Info {
  name: string;
  welcomeMessage: string;
  suggestedQuestions: string[];
  appearance?: { color?: string | null; avatar?: string | null };
}

declare global {
  interface Window { Kahiye?: { open: () => void; ask: (text: string) => void } }
}

const FALLBACK_QUESTIONS = ["What are your timings?", "What are the fees / prices?", "Where are you located?", "Can someone call me back?"];

/**
 * Shareable demo page for one bot (/try/{publicKey}): the business owner opens the link on their phone and
 * chats with an assistant built from their own information, before anything is installed on their website.
 */
export default function TryPage() {
  const { key } = useParams<{ key: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/chat/${encodeURIComponent(key)}/info`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((i: Info) => {
        setInfo(i);
        document.title = `${i.name} · AI assistant demo`;
      })
      .catch(() => setMissing(true));
  }, [key]);

  // the real widget, opened as soon as it has loaded
  useEffect(() => {
    if (!info) return;
    const s = document.createElement("script");
    s.src = `${gatewayOrigin()}/widget.js`;
    s.dataset.botKey = key;
    s.async = true;
    s.onload = () => {
      setReady(true);
      if (window.matchMedia("(min-width: 700px)").matches) setTimeout(() => window.Kahiye?.open(), 600);
    };
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-kahiye]").forEach((el) => el.remove());
    };
  }, [info, key]);

  if (missing) {
    return (
      <div className="try-page">
        <div className="try-card center">
          <h1 className="display-2">This demo link is not active.</h1>
          <p className="muted">Ask the person who sent it for a new link.</p>
          <Link href="/" className="btn">About Kahiye</Link>
        </div>
      </div>
    );
  }
  if (!info) return <div className="auth-wrap"><span className="spinner" aria-label="Loading" /></div>;

  const color = info.appearance?.color || "#0f766e"; // the widget's own default, so page and chat match
  const questions = (info.suggestedQuestions?.length ? info.suggestedQuestions : FALLBACK_QUESTIONS).slice(0, 4);
  const cta = site.whatsapp
    ? whatsappLink(`Hi! I tried the AI assistant demo for ${info.name}. I'd like to put it on our website.`)
    : "/register";

  return (
    <div className="try-page" style={{ ["--w" as string]: color }}>
      <meta name="robots" content="noindex" />
      <div className="try-glow" aria-hidden />
      <main className="try-card">
        <div className="try-brand">
          {info.appearance?.avatar
            ? <img src={info.appearance.avatar} alt="" className="try-avatar" />
            : <span className="try-avatar" aria-hidden>{info.name.slice(0, 1).toUpperCase()}</span>}
          <span className="try-tag"><span className="live-dot" aria-hidden /> Live demo</span>
        </div>
        <h1 className="display-2">{info.name}&apos;s new <em>AI assistant</em></h1>
        <p className="try-lead">
          Ask it anything your customers ask you every day. It answers from {info.name}&apos;s own information, in seconds,
          at any hour, in English, Hindi or Hinglish, and takes the number of anyone who wants a call back.
        </p>

        <p className="try-label">Try one of these:</p>
        <div className="try-chips">
          {questions.map((q) => (
            <button key={q} className="try-chip" disabled={!ready} onClick={() => window.Kahiye?.ask(q)}>{q}</button>
          ))}
          <button className="try-chip ghost" disabled={!ready} onClick={() => window.Kahiye?.ask("Aapki fees kitni hai?")}>Aapki fees kitni hai?</button>
        </div>
        <p className="muted small">Or tap the chat bubble in the corner and type your own question.</p>

        <div className="try-foot">
          <a className="btn" href={cta} target={site.whatsapp ? "_blank" : undefined} rel="noopener noreferrer">
            Put this on our website
          </a>
          <span className="muted small">Demo made with <Link href="/">Kahiye</Link></span>
        </div>
      </main>
    </div>
  );
}
