"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { clearSession, getSession, Session } from "@/lib/api";

/** Layout for logged-in pages; sends visitors without a valid session to /login. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace("/login");
    else setSession(s);
  }, [router]);

  if (!session) {
    return (
      <div className="auth-wrap">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <Logo href="/bots" />
        <nav className="topbar-nav" aria-label="Main">
          <Link href="/bots" className={pathname?.startsWith("/bots") ? "active" : ""}>Bots</Link>
          <Link href="/demo">Demo site</Link>
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
      <main className="container">{children}</main>
    </>
  );
}
