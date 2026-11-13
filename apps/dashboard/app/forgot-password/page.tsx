"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import CenterCard from "@/components/CenterCard";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenterCard>
      <h1>Forgot your password?</h1>
      {sent ? (
        <>
          <div className="alert ok" role="status">
            If an account exists for {email.trim()}, we have sent a link to choose a new password. It is valid for 1 hour.
          </div>
          <p className="muted small">Nothing arrived after a few minutes? Check your spam folder, or try again.</p>
          <Link href="/login">← Back to log in</Link>
        </>
      ) : (
        <>
          <p className="muted">Enter your email and we&apos;ll send you a link to choose a new password.</p>
          {error && <div className="alert error" role="alert">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn block" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          </form>
          <p className="muted small" style={{ marginTop: 16, marginBottom: 0 }}>
            Remembered it? <Link href="/login">Log in</Link>
          </p>
        </>
      )}
    </CenterCard>
  );
}
