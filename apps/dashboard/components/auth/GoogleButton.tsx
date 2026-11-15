"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface GoogleIdApi {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleIdApi } } }
}

let scriptLoading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google sign-in could not load"));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

export const googleEnabled = () => CLIENT_ID.length > 0;

/**
 * Google's own "Continue with Google" button (Google Identity Services). Google checks the person; our server then
 * verifies Google's signed token. Hidden when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set.
 */
export default function GoogleButton({ text, tenantName, onDone, onError }: {
  text: "signin_with" | "signup_with" | "continue_with";
  tenantName?: string;
  onDone: (isNew: boolean) => void;
  onError: (message: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ tenantName, onDone, onError });
  latest.current = { tenantName, onDone, onError };

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !box.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async ({ credential }) => {
          setBusy(true);
          try {
            latest.current.onDone(await api.google(credential, latest.current.tenantName?.trim() || undefined));
          } catch (e) {
            latest.current.onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      });
      window.google.accounts.id.renderButton(box.current, {
        type: "standard", theme: "outline", size: "large", shape: "pill", text, logo_alignment: "center",
        width: Math.min(box.current.clientWidth || 360, 400),
      });
    }).catch(() => latest.current.onError("Google sign-in could not load. Use email instead."));
    return () => { cancelled = true; };
  }, [text]);

  if (!CLIENT_ID) return null;
  return (
    <div className="google-wrap" aria-busy={busy}>
      <div ref={box} className="google-btn" />
      {busy && <span className="spinner" aria-label="Signing in" />}
    </div>
  );
}
