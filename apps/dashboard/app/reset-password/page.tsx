"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import CenterCard from "@/components/CenterCard";
import { api } from "@/lib/api";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);   // undefined = not read yet
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token")), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== repeat) return setError("The two passwords are not the same.");
    setBusy(true);
    try {
      await api.resetPassword(token ?? "", password);
      router.replace("/bots");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <CenterCard>
      <h1>Choose a new password</h1>
      {token === null || token === "" ? (
        <>
          <div className="alert error" role="alert">This link is incomplete. Open the link from the email again.</div>
          <Link href="/forgot-password">Ask for a new link</Link>
        </>
      ) : (
        <>
          {error && (
            <div className="alert error" role="alert">
              {error} {error.includes("expired") && <Link href="/forgot-password">Ask for a new link</Link>}
            </div>
          )}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">New password</label>
              <input id="password" type="password" required minLength={8} value={password} autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="repeat">Repeat the new password</label>
              <input id="repeat" type="password" required minLength={8} value={repeat} autoComplete="new-password"
                onChange={(e) => setRepeat(e.target.value)} />
            </div>
            <button className="btn block" type="submit" disabled={busy || !token}>{busy ? "Saving…" : "Save and log in"}</button>
          </form>
        </>
      )}
    </CenterCard>
  );
}
