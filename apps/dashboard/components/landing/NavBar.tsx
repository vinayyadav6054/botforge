"use client";

import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import Logo from "@/components/Logo";
import NavCta from "./NavCta";

/** Transparent over the hero, frosted glass once the page scrolls; a thin progress bar shows how far you have read. */
export default function NavBar() {
  const { scrollY, scrollYProgress } = useScroll();
  const [solid, setSolid] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setSolid(y > 24));
  return (
    <header className={`lp-nav${solid ? " solid" : ""}`}>
      <div className="lp-wrap lp-nav-inner">
        <Logo />
        <nav className="lp-nav-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#demo">Live demo</a>
          <a href="#how">How it works</a>
          <a href="#trust">Security</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="lp-nav-cta"><NavCta /></div>
      </div>
      <motion.div className="lp-progress" style={{ scaleX: scrollYProgress }} aria-hidden />
    </header>
  );
}
