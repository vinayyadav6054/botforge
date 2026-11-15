"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { ReactNode, useEffect } from "react";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** Each page (or bot section) arrives with a short lift and fade. */
export function PageTransition({ id, children }: { id: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div key={id} initial={reduce ? false : { opacity: 0, y: 14, filter: "blur(4px)" }}
      // filter and transform cleared at the end: otherwise fixed overlays inside (toasts, dialogs) are trapped
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }} transition={{ duration: 0.45, ease }}>
      {children}
    </motion.div>
  );
}

/** The highlight behind the active menu item; it glides to the new item (shared layout animation). */
export function ActivePill({ group }: { group: string }) {
  return <motion.span layoutId={`pill-${group}`} className="active-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} aria-hidden />;
}

/** A card that tilts slightly toward the cursor. */
export function Tilt({ children, className, max = 6, as = "div", ...rest }: {
  children: ReactNode; className?: string; max?: number; as?: "div" | "button"; onClick?: () => void; type?: "button";
}) {
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 });
  const Comp = as === "button" ? motion.button : motion.div;
  return (
    <Comp className={className} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }} {...rest}
      onPointerMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}>
      {children}
    </Comp>
  );
}

/** Lists whose items slide in, out and into place (AutoAnimate). */
export function AnimatedList({ as = "div", className, children, ...rest }: {
  as?: "div" | "ul" | "tbody"; className?: string; children: ReactNode; role?: string;
}) {
  const [ref] = useAutoAnimate<HTMLElement>({ duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
  const Tag = as as "div";
  return <Tag ref={ref as React.Ref<HTMLDivElement>} className={className} {...rest}>{children}</Tag>;
}

/** Toast that springs in and fades away. */
export function Toast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div key={message} className="alert ok toast" role="status"
          initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}>
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A soft ripple from the point of every click on buttons and menu items. */
export function ClickRipples() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.(".btn, .side-links a, .side-links button, .settings-tabs button, .tabstrip button, .stat.link, .convo-item, .bot-card") as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.overflow = "hidden";
      el.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}

/** A small burst of confetti, e.g. when the first document is ready. */
export function Celebrate({ show }: { show: boolean }) {
  const pieces = Array.from({ length: 18 }, (_, i) => i);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="celebrate" aria-hidden initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {pieces.map((i) => {
            const angle = (i / pieces.length) * Math.PI * 2;
            return (
              <motion.i key={i} style={{ background: ["#5b5bf6", "#8b5cf6", "#22c3ee", "#12a150", "#f5b84a"][i % 5] }}
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
                animate={{ x: Math.cos(angle) * (70 + (i % 3) * 30), y: Math.sin(angle) * (70 + (i % 3) * 30) + 30, scale: 1, opacity: 0, rotate: 240 }}
                transition={{ duration: 1.1, ease: "easeOut" }} />
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
