"use client";

import { useEffect } from "react";

/**
 * Fades sections in as they scroll into view. Content stays visible without JavaScript or with reduced motion:
 * elements are only hidden after this has run (the `reveal-on` class on <html>).
 */
export default function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    // anything already on screen shows at once; the rest waits for the scroll
    for (const el of els) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in");
      else io.observe(el);
    }
    document.documentElement.classList.add("reveal-on");
    return () => io.disconnect();
  }, []);
  return null;
}
