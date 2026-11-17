"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const KEY = "kahiye.notice";

/**
 * We use no tracking or advertising cookies, only storage the service needs (login, chat continuity), so this is a
 * notice, not a consent wall. It appears once and remembers that it has been seen.
 */
// inside the app (after login) the notice has been seen at sign-up; it would only cover the sidebar there
const APP_PATHS = ["/bots", "/account", "/admin"];

export default function CookieNotice() {
  const pathname = usePathname() ?? "/";
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* storage blocked: nothing is stored either, so there is nothing to tell */
    }
  }, []);

  function close() {
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
  }

  return (
    <AnimatePresence>
      {show && !APP_PATHS.some((p) => pathname.startsWith(p)) && (
        <motion.div className="cookie" role="region" aria-label="Storage notice"
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: 0.8, duration: 0.4 }}>
          <p>
            No ads, no tracking. We only store what the app needs to work, like keeping you logged in.{" "}
            <Link href="/privacy#cookies">Details</Link>
          </p>
          <button className="btn small" onClick={close}>Got it</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
