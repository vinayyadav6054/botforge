"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/api";

/** "Log in / Start free" for visitors, "Open dashboard" for owners who are already logged in. */
export default function NavCta() {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => setLoggedIn(!!getSession()), []);

  return loggedIn ? (
    <Link href="/bots" className="btn">Open dashboard</Link>
  ) : (
    <>
      <Link href="/login" className="nav-login">Log in</Link>
      <Link href="/register" className="btn">Start free</Link>
    </>
  );
}
