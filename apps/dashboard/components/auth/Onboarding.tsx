"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Celebrate } from "@/components/AppMotion";
import AuthLayout from "@/components/auth/AuthLayout";
import GoogleButton, { googleEnabled } from "@/components/auth/GoogleButton";
import PasswordInput, { passwordStrength } from "@/components/auth/PasswordInput";
import { api, ApiError, getSession } from "@/lib/api";
import { INDUSTRIES, LANGUAGES } from "@/lib/industries";

type Step = "account" | "business" | "knowledge" | "done";
const STEPS: { id: Step; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "business", label: "Business" },
  { id: "knowledge", label: "Teach it" },
  { id: "done", label: "Ready" },
];
const ALLOWED = [".pdf", ".txt", ".md", ".docx", ".xlsx", ".csv"];

/**
 * Sign-up in four short layers: account → business → knowledge → ready. Each step does one thing, uses plain words,
 * and can be skipped after the account exists (everything can be changed later in the dashboard).
 */
export default function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>("account");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [industry, setIndustry] = useState("coaching");
  const [language, setLanguage] = useState("auto");
  const [website, setWebsite] = useState("");
  const [botId, setBotId] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<"idle" | "reading" | "ready">("idle");
  const file = useRef<HTMLInputElement>(null);

  // Google sign-ups and returning visitors continue where they are; logged-in owners without a reason to be here go to the app
  useEffect(() => {
    const session = getSession();
    const wanted = params.get("step");
    if (session && wanted === "business") {
      setStep("business");
      api.me().then((m) => setBusiness((b) => b || m.tenantName)).catch(() => undefined);
    } else if (session && step === "account") {
      router.replace("/bots");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (passwordStrength(password).score === 0) return setError("Please use a password of at least 8 characters.");
    setBusy(true);
    try {
      await api.register(business.trim(), email.trim(), password);
      setStep("business");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "This email already has an account. Please log in." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createAssistant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const preset = INDUSTRIES.find((i) => i.id === industry) ?? INDUSTRIES[INDUSTRIES.length - 1];
    const name = business.trim() || "My business";
    setBusy(true);
    try {
      const bot = await api.createBot(name, preset.welcome);
      await api.updateBot(bot.id, {
        name, suggestedQuestions: preset.questions, replyLanguage: language,
        leadCaptureEnabled: true, leadCourseLabel: preset.leadLabel, leadAskCourse: true,
      });
      setBotId(bot.id);
      setStep("knowledge");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addKnowledge(kind: "file" | "website" | "sample", files?: FileList | null) {
    if (!botId) return;
    setError(null);
    setBusy(true);
    try {
      if (kind === "file" && files?.length) {
        for (const f of Array.from(files)) {
          if (!ALLOWED.some((x) => f.name.toLowerCase().endsWith(x))) throw new Error(`${f.name}: please use PDF, Word, Excel, CSV or text files.`);
          await api.uploadDocument(botId, f);
        }
      } else if (kind === "website") {
        const url = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
        await api.addSource(botId, { kind: "website", url, syncIntervalDays: 7 });
      } else if (kind === "sample") {
        const text = await (await fetch("/samples/sunrise-academy.txt")).text();
        await api.uploadDocument(botId, new File([text], "sample-coaching-institute.txt", { type: "text/plain" }));
      } else {
        return;
      }
      setKnowledge("reading");
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // on the last step, show when the assistant has finished reading
  useEffect(() => {
    if (step !== "done" || !botId || knowledge !== "reading") return;
    const t = setInterval(async () => {
      try {
        const docs = await api.listDocuments(botId);
        if (docs.some((d) => d.status === "Ready")) setKnowledge("ready");
      } catch { /* keep waiting */ }
    }, 2500);
    return () => clearInterval(t);
  }, [step, botId, knowledge]);

  const index = STEPS.findIndex((s) => s.id === step);

  return (
    <AuthLayout>
      <ol className="ob-steps" aria-label="Sign-up steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < index ? "done" : i === index ? "now" : ""} aria-current={i === index ? "step" : undefined}>
            <span>{i < index ? "✓" : i + 1}</span>{s.label}
          </li>
        ))}
      </ol>
      <div className="ob-bar" aria-hidden><motion.span animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.5 }} /></div>

      {error && <div className="alert error" role="alert">{error}</div>}

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3 }}>
          {step === "account" && (
            <>
              <h1>Create your free account</h1>
              <p className="au-sub">14 days free. No card needed. Takes about 2 minutes.</p>
              {googleEnabled() && (
                <>
                  <GoogleButton text="signup_with" tenantName={business}
                    onDone={(isNew) => { if (isNew) { setStep("business"); api.me().then((m) => setBusiness(m.tenantName)).catch(() => undefined); } else router.replace("/bots"); }}
                    onError={setError} />
                  <div className="au-or"><span>or with email</span></div>
                </>
              )}
              <form onSubmit={createAccount}>
                <div className="field">
                  <label htmlFor="tenantName">Business name</label>
                  <input id="tenantName" type="text" required maxLength={200} value={business} onChange={(e) => setBusiness(e.target.value)}
                    autoComplete="organization" placeholder="e.g. Sunrise Academy" />
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@business.com" />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" meter />
                </div>
                <button className="btn block lg" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
                <p className="au-legal">By creating an account you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy policy</Link>.</p>
              </form>
              <p className="au-switch">Already have an account? <Link href="/login">Log in</Link></p>
            </>
          )}

          {step === "business" && (
            <form onSubmit={createAssistant}>
              <h1>Tell us about your business</h1>
              <p className="au-sub">We use this to set up your assistant. You can change everything later.</p>
              {!business && (
                <div className="field">
                  <label htmlFor="bizName">Business name</label>
                  <input id="bizName" type="text" required maxLength={200} value={business} onChange={(e) => setBusiness(e.target.value)} />
                </div>
              )}
              <fieldset className="ob-industries">
                <legend>What kind of business is it?</legend>
                {INDUSTRIES.map((i) => (
                  <label key={i.id} className={industry === i.id ? "on" : ""}>
                    <input type="radio" name="industry" value={i.id} checked={industry === i.id} onChange={() => setIndustry(i.id)} />
                    <span aria-hidden>{i.icon}</span>{i.label}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="language">Which language should it reply in?</label>
                <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} className="status-select wide">
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="website">Your website (optional)</label>
                <input id="website" type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.yourbusiness.com" inputMode="url" />
              </div>
              <button className="btn block lg" type="submit" disabled={busy}>{busy ? "Setting up…" : "Continue"}</button>
              <p className="au-switch"><Link href="/bots">Skip setup for now</Link></p>
            </form>
          )}

          {step === "knowledge" && (
            <>
              <h1>Teach your assistant</h1>
              <p className="au-sub">It answers only from what you give it. Pick one way; you can add more later.</p>
              <div className="ob-options">
                <button type="button" className="ob-option" disabled={busy} onClick={() => file.current?.click()}>
                  <span aria-hidden>📄</span><strong>Upload a file</strong><small>Brochure, fee list, menu or FAQ (PDF, Word, Excel)</small>
                </button>
                <input ref={file} type="file" hidden multiple accept={ALLOWED.join(",")} aria-label="Upload documents" onChange={(e) => void addKnowledge("file", e.target.files)} />
                <div className="ob-option as-form">
                  <span aria-hidden>🌐</span><strong>Read my website</strong>
                  <div className="ob-inline">
                    <input type="text" inputMode="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.yourbusiness.com" aria-label="Website address" />
                    <button type="button" className="btn small" disabled={busy || !website.trim()} onClick={() => void addKnowledge("website")}>Read</button>
                  </div>
                </div>
                <button type="button" className="ob-option" disabled={busy} onClick={() => void addKnowledge("sample")}>
                  <span aria-hidden>🧪</span><strong>Try with a sample</strong><small>A coaching institute&apos;s fees and timings, to see how it works</small>
                </button>
              </div>
              {busy && <p className="au-sub"><span className="spinner" /> Uploading…</p>}
              <p className="au-switch"><Link href={botId ? `/bots/${botId}#knowledge` : "/bots"}>I&apos;ll do this later</Link></p>
            </>
          )}

          {step === "done" && (
            <div className="ob-done" style={{ position: "relative" }}>
              <Celebrate show={knowledge === "ready"} />
              <div className="ob-done-icon" aria-hidden>{knowledge === "ready" ? "🎉" : "📖"}</div>
              <h1>{knowledge === "ready" ? "Your assistant is ready!" : "Your assistant is reading…"}</h1>
              <p className="au-sub">
                {knowledge === "ready"
                  ? "Ask it a question the way your customers would, then put it on your website."
                  : "This takes about a minute. You can wait here or go ahead: it keeps reading in the background."}
              </p>
              <div className="ob-done-actions">
                <Link className="btn block lg" href={botId ? `/bots/${botId}#answers` : "/bots"}>Test my assistant</Link>
                <Link className="btn secondary block" href={botId ? `/bots/${botId}` : "/bots"}>Go to my dashboard</Link>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthLayout>
  );
}
