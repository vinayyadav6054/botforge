"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CenterCard from "@/components/CenterCard";
import { api, getSession } from "@/lib/api";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"working" | "done" | string>("working");
  const started = useRef(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    if (started.current) return;   // tokens work once: never send it twice (React dev mode runs effects twice)
    started.current = true;
    setLoggedIn(!!getSession());
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("This link is incomplete. Open the link from the email again.");
      return;
    }
    api.verifyEmail(token).then(() => setState("done")).catch((e: Error) => setState(e.message));
  }, []);

  return (
    <CenterCard>
      <h1>Confirm your email</h1>
      {state === "working" && <p className="muted"><span className="spinner" style={{ verticalAlign: "middle" }} /> Checking your link…</p>}
      {state === "done" && (
        <>
          <div className="alert ok" role="status">Thank you! Your email is confirmed.</div>
          <Link className="btn" href={loggedIn ? "/bots" : "/login"}>{loggedIn ? "Go to your bots" : "Log in"}</Link>
        </>
      )}
      {state !== "working" && state !== "done" && (
        <>
          <div className="alert error" role="alert">{state}</div>
          <p className="muted small">
            You can send a new link from the banner at the top of the dashboard after you <Link href="/login">log in</Link>.
          </p>
        </>
      )}
    </CenterCard>
  );
}
