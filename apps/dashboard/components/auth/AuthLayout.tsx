"use client";

import { motion } from "motion/react";
import Link from "next/link";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** Login and sign-up: the form on the left, a bright product preview with trust points on the right. */
export default function AuthLayout({ children, aside = "default" }: { children: React.ReactNode; aside?: "default" | "none" }) {
  return (
    <div className="au">
      <div className="au-main">
        <header className="au-top">
          <Logo />
          <Link href="/help" className="au-help">Need help?</Link>
        </header>
        <motion.div className="au-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
          {children}
        </motion.div>
        <footer className="au-foot">
          <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><span>© {new Date().getFullYear()} Kahiye</span>
        </footer>
      </div>
      {aside === "default" && (
        <aside className="au-side" aria-hidden>
          <div className="au-side-inner">
            <motion.div className="au-chat" initial={{ opacity: 0, y: 30, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: -2 }} transition={{ duration: 0.8, delay: 0.15, ease }}>
              <div className="au-chat-head"><span>S</span><div><strong>Sunrise Academy</strong><small>● Online · replies instantly</small></div></div>
              <div className="au-msg v">Weekend batch hai kya?</div>
              <div className="au-msg b">Yes! Saturday &amp; Sunday, 9 AM to 1 PM. Fees ₹68,000 a year in 3 instalments. Shall I book a free demo?</div>
            </motion.div>
            <motion.div className="au-lead" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.7, delay: 0.6, ease }}>
              <span className="au-ping" /><div><small>New lead · 10:47 PM</small><strong>Rohan M. · JEE 2027</strong></div>
            </motion.div>
            <h2>Your AI receptionist, ready in <span className="lp-grad">10 minutes</span>.</h2>
            <ul>
              <li>Answers from your own brochure, fees and FAQs</li>
              <li>Hindi, Hinglish and English, on your website and WhatsApp</li>
              <li>Every interested customer's number, sent to you instantly</li>
            </ul>
            <p className="au-trust"><Icon name="lock" size={14} /> Private workspace · Export or delete your data any time · No card needed</p>
          </div>
        </aside>
      )}
    </div>
  );
}
