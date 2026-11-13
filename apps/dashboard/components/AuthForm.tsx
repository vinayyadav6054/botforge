"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { api, ApiError, getSession } from "@/lib/api";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";

  useEffect(() => {
    if (getSession()) router.replace("/bots");
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRegister && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (isRegister) await api.register(tenantName.trim(), email.trim(), password);
      else await api.login(email.trim(), password);
      router.replace("/bots");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Wrong email or password."
          : err instanceof Error
            ? err.message
            : "Something went wrong."
      );
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <aside className="auth-side">
        <span className="glow" />
        <Logo />
        <div>
          <h2>
            {isRegister ? <>Answer every visitor. <em>Even at 2 AM.</em></> : <>Good to see you <em>again.</em></>}
          </h2>
          <ul>
            <li>Learns from your PDFs, Word files and FAQs</li>
            <li>Collects names and phone numbers for you</li>
            <li>One line of code on any website</li>
          </ul>
        </div>
        <p className="quote">Built for coaching classes, clinics, builders, restaurants and every business that answers the same questions all day.</p>
      </aside>
      <main className="auth-main">
      <div className="auth-card">
        <div className="auth-mobile-brand"><Logo /></div>
        <h1>{isRegister ? "Create your workspace" : "Welcome back"}</h1>
        <p className="muted">
          {isRegister ? "Set up a chatbot that answers from your own documents." : "Log in to manage your bots."}
        </p>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          {isRegister && (
            <div className="field">
              <label htmlFor="tenantName">Business name</label>
              <input id="tenantName" type="text" required maxLength={200} value={tenantName}
                onChange={(e) => setTenantName(e.target.value)} autoComplete="organization" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={isRegister ? 8 : undefined} value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"} />
          </div>
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? "Please wait..." : isRegister ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="muted small" style={{ marginTop: 16, marginBottom: 0 }}>
          {isRegister ? (
            <>Already have an account? <Link href="/login">Log in</Link></>
          ) : (
            <>New here? <Link href="/register">Create an account</Link></>
          )}
        </p>
      </div>
      </main>
    </div>
  );
}
