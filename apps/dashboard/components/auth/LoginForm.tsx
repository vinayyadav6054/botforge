"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import AuthLayout from "@/components/auth/AuthLayout";
import GoogleButton, { googleEnabled } from "@/components/auth/GoogleButton";
import PasswordInput from "@/components/auth/PasswordInput";
import { api, ApiError, getSession } from "@/lib/api";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) router.replace("/bots");
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(email.trim(), password);
      router.replace("/bots");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong email or password." : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1>Welcome back</h1>
      <p className="au-sub">Log in to see your leads and chats.</p>

      {googleEnabled() && (
        <>
          <GoogleButton text="signin_with" onDone={(isNew) => router.replace(isNew ? "/register?step=business" : "/bots")} onError={setError} />
          <div className="au-or"><span>or with email</span></div>
        </>
      )}

      {error && <div className="alert error" role="alert">{error}</div>}

      <form onSubmit={onSubmit} noValidate={false}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@business.com" />
        </div>
        <div className="field">
          <div className="au-label-row">
            <label htmlFor="password">Password</label>
            <Link href="/forgot-password" className="small">Forgot password?</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <button className="btn block lg" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
      </form>

      <p className="au-switch">New to Kahiye? <Link href="/register">Create a free account</Link></p>
    </AuthLayout>
  );
}
