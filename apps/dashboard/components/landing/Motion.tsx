"use client";

import { AnimatePresence, motion, useScroll, useSpring, useTransform } from "motion/react";
import { ReactNode, useRef, useState } from "react";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** Fades and lifts its content in when it scrolls into view (once). */
export function FadeIn({ children, delay = 0, y = 26, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }} viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.7, delay, ease }}>
      {children}
    </motion.div>
  );
}

/** A grid whose children come in one after another. */
export function Stagger({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}>
      {children.map((child, i) => (
        <motion.div key={i} className="stagger-item" variants={{
          hidden: { opacity: 0, y: 30, scale: 0.97 },
          show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease } },
        }}>{child}</motion.div>
      ))}
    </motion.div>
  );
}

/** Cards with a glow that follows the cursor (sets --mx / --my on the hovered card). */
export function SpotlightGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} onPointerMove={(e) => {
      const card = (e.target as HTMLElement).closest?.(".spot") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }}>
      {children}
    </div>
  );
}

/** "How it works": a line that draws itself as you scroll past the steps. */
export function ScrollSteps({ steps }: { steps: { title: string; text: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const height = useTransform(progress, [0, 1], ["0%", "100%"]);
  return (
    <ol className="lp-steps" ref={ref}>
      <div className="lp-steps-rail" aria-hidden><motion.div className="lp-steps-fill" style={{ height }} /></div>
      {steps.map((s, i) => (
        <motion.li key={s.title} initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "0px 0px -120px 0px" }} transition={{ duration: 0.6, ease }}>
          <span className="lp-step-num">{i + 1}</span>
          <div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

/** FAQ with smooth open / close. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="lp-faq">
      {items.map((f, i) => (
        <div key={f.q} className={`lp-faq-item${open === i ? " open" : ""}`}>
          <button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            <span>{f.q}</span>
            <motion.span className="lp-faq-plus" animate={{ rotate: open === i ? 45 : 0 }} aria-hidden>+</motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease }} style={{ overflow: "hidden" }}>
                <p>{f.a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
