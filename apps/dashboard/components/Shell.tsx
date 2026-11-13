"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { Account, api, clearSession, getSession, Me, Session } from "@/lib/api";

export function daysLeft(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Layout for logged-in pages; sends visitors without a valid session to /login. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | string>("idle");

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace("/login");
    else setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    // banners are extras: the page works even if these calls fail
    api.me().then(setMe).catch(() => undefined);
    api.account().then(setAccount).catch(() => undefined);
  }, [session]);

  if (!session) {
    return (
      <div className="auth-wrap">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  async function resendEmail() {
    setResend("sending");
    try {
      const r = await api.resendVerification();
      if (r.emailVerified) setMe((m) => (m ? { ...m, emailVerified: true } : m));
      setResend("sent");
    } catch (e) {
      setResend((e as Error).message);
    }
  }

  const sub = account?.subscription;
  const expired = account?.plan.id === "expired";
  const trialDays = sub?.status === "trialing" ? daysLeft(sub.trialEndsAt) : null;

  return (
    <>
      <header className="topbar">
        <Logo href="/bots" />
        <nav className="topbar-nav" aria-label="Main">
          <Link href="/bots" className={pathname?.startsWith("/bots") ? "active" : ""}>Bots</Link>
          <Link href="/account" className={pathname?.startsWith("/account") ? "active" : ""}>Plan &amp; account</Link>
        </nav>
        <div className="who">
          <span className="user-pill" title={session.email}>
            <span className="user-avatar" aria-hidden>{session.email.slice(0, 1).toUpperCase()}</span>
            <span className="hide-sm">{session.email}</span>
          </span>
          <button
            className="btn secondary small"
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {expired && (
        <div className="banner danger" role="status">
          Your {sub?.status === "trialing" ? "free trial" : "plan"} has ended, so your bots are not answering visitors.{" "}
          <Link href="/account">Choose a plan</Link>
        </div>
      )}
      {!expired && trialDays !== null && trialDays <= 5 && (
        <div className="banner warn" role="status">
          Your free trial ends in {trialDays} day{trialDays === 1 ? "" : "s"}. <Link href="/account">Choose a plan</Link> to keep your bots answering.
        </div>
      )}
      {me && !me.emailVerified && (
        <div className="banner info" role="status">
          Please confirm your email ({me.email}) so you can reset your password and get monthly reports.{" "}
          {resend === "sent" ? (
            <strong>Sent! Check your inbox and spam folder.</strong>
          ) : (
            <button className="link-btn" onClick={resendEmail} disabled={resend === "sending"}>
              {resend === "sending" ? "Sending…" : "Send the link again"}
            </button>
          )}
          {resend !== "idle" && resend !== "sending" && resend !== "sent" && <span> {resend}</span>}
        </div>
      )}

      <main className="container">{children}</main>
    </>
  );
}
