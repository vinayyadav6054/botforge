"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActivePill, ClickRipples, PageTransition } from "@/components/AppMotion";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import { Account, api, clearSession, getSession, Me, Session } from "@/lib/api";

export function daysLeft(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

const TRIAL_DAYS = 14;

/**
 * Layout for logged-in pages: a fixed sidebar (a drawer on phones) and a full-width work area.
 * `subnav` lets a page add its own section links to the sidebar (the bot page does). Sends visitors without a session to /login.
 */
export default function Shell({ children, subnav }: { children: React.ReactNode; subnav?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | string>("idle");
  const [drawer, setDrawer] = useState(false);

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

  // close the phone drawer after navigating
  useEffect(() => setDrawer(false), [pathname]);

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
  const usagePct = account ? Math.min(100, Math.round((account.usage.answers / Math.max(1, account.plan.answersPerMonth)) * 100)) : 0;

  return (
    <div className={`app${drawer ? " drawer-open" : ""}`}>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-top">
          <Logo href="/bots" />
          <button className="icon-btn only-phone" onClick={() => setDrawer(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        <nav className="side-links" aria-label="Main">
          <Link href="/bots" className={pathname === "/bots" ? "active" : ""}>
            {pathname === "/bots" && <ActivePill group="main" />}<Icon name="bots" /> Bots
          </Link>
          <Link href="/account" className={pathname?.startsWith("/account") ? "active" : ""}>
            {pathname?.startsWith("/account") && <ActivePill group="main" />}<Icon name="plan" /> Plan &amp; account
          </Link>
        </nav>

        {subnav && <div className="side-sub">{subnav}</div>}

        <div className="sidebar-foot">
          {account && (
            <Link href="/account" className={`plan-card${expired ? " expired" : ""}`}>
              <div className="plan-card-top">
                <strong>{expired ? "Plan ended" : trialDays !== null ? "Free trial" : `${account.plan.name} plan`}</strong>
                {trialDays !== null && !expired && <span>{trialDays} day{trialDays === 1 ? "" : "s"} left</span>}
              </div>
              {trialDays !== null && !expired ? (
                <div className="meter" aria-hidden><span style={{ width: `${Math.max(4, (trialDays / TRIAL_DAYS) * 100)}%` }} /></div>
              ) : (
                <div className="meter" aria-hidden><span style={{ width: `${Math.max(2, usagePct)}%` }} /></div>
              )}
              <div className="plan-card-sub">
                {expired ? "Choose a plan to switch your bots back on →"
                  : `${account.usage.answers.toLocaleString()} / ${account.plan.answersPerMonth.toLocaleString()} answers this month`}
              </div>
            </Link>
          )}
          <div className="side-user">
            <span className="user-avatar" aria-hidden>{session.email.slice(0, 1).toUpperCase()}</span>
            <span className="side-email" title={session.email}>{session.email}</span>
            <button
              className="icon-btn"
              title="Log out"
              aria-label="Log out"
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />

      <div className="workspace">
        <header className="mobilebar">
          <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <Logo href="/bots" />
          <span className="user-avatar" aria-hidden>{session.email.slice(0, 1).toUpperCase()}</span>
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

        <main className="container"><PageTransition id={pathname ?? ""}>{children}</PageTransition></main>
        <ClickRipples />
      </div>
    </div>
  );
}
