"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** "Watch the intro" button and a player for the 90-second product video (recorded from the real product). */
export default function IntroVideo() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="btn ghost lg" onClick={() => setOpen(true)}>
        <span className="play-dot" aria-hidden>▶</span> Watch 90-sec intro
      </button>
      {/* rendered on <body>: inside the animated hero, a fixed overlay would be trapped by the blur transition */}
      {mounted && createPortal(<AnimatePresence>
        {open && (
          <motion.div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Kahiye intro video" onClick={() => setOpen(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-lenis-prevent>
            <motion.div className="video-box" onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }}>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close video">×</button>
              <video src="/media/kahiye-intro.mp4" poster="/media/kahiye-intro-poster.jpg" controls autoPlay playsInline preload="metadata" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </>
  );
}
