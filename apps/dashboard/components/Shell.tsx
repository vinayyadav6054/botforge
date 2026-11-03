"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSession, getSession, Session } from "@/lib/api";

/** Layout for logged-in pages; sends visitors without a valid session to /login. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
        <Link href="/bots" className="brand">
          Bot<span>Forge</span>
        </Link>
        <div className="who">
          <span>{session.email}</span>
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
