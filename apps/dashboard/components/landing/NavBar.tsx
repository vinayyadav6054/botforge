"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import Logo from "@/components/Logo";
import NavCta from "./NavCta";

const LINKS = [
  ["#features", "Features"],
  ["#demo", "Live demo"],
  ["#how", "How it works"],
  ["#pricing", "Pricing"],
  ["#faq", "FAQ"],
] as const;

/** Clear over the hero, frosted white once the page scrolls; a menu on phones; a thin bar shows reading progress. */
export default function NavBar({ home = true }: { home?: boolean }) {
  const { scrollY, scrollYProgress } = useScroll();
  const [solid, setSolid] = useState(false);
  const [menu, setMenu] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 16));
  useEffect(() => {
    const close = () => setMenu(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, []);

  return (
    <>
      <header className={`lp-nav${solid || menu ? " solid" : ""}`}>
        <div className="lp-wrap lp-nav-inner">
          <Logo />
          <nav className="lp-nav-links" aria-label="Sections">
            {LINKS.map(([href, label]) => <a key={href} href={home ? href : `/${href}`}>{label}</a>)}
          </nav>
          <div className="lp-nav-cta">
            <NavCta />
            <button className="lp-burger" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Icon name={menu ? "close" : "menu"} />
            </button>
          </div>
        </div>
        <motion.div className="lp-progress" style={{ scaleX: scrollYProgress }} aria-hidden />
      </header>
      <AnimatePresence>
        {menu && (
          <motion.nav className="lp-menu" aria-label="Menu" initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} onClick={() => setMenu(false)}>
            {LINKS.map(([href, label]) => <a key={href} href={home ? href : `/${href}`}>{label}</a>)}
            <Link href="/login">Log in</Link>
            <Link href="/register" className="btn block">Start free</Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
