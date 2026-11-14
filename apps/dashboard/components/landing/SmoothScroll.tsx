"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Smooth, inertial scrolling for the public pages (Lenis), including "#section" links.
 * Off for visitors who prefer less motion; never touches scrolling inside the chat widget.
 */
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => 1 - Math.pow(1 - t, 4),
      smoothWheel: true,
      // the chat widget (shadow DOM host) and marked areas keep their own scrolling
      prevent: (node) => !!(node as HTMLElement).closest?.("[data-kahiye], [data-lenis-prevent]"),
    });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      const id = link?.getAttribute("href");
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -72 });
      history.replaceState(null, "", id);
    };
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick);
      lenis.destroy();
    };
  }, []);
  return null;
}
