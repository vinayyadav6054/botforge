"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Line = { who: "visitor" | "bot"; text: string };
const SCRIPTS: { business: string; initial: string; lines: Line[]; lead: string }[] = [
  {
    business: "Sunrise Academy", initial: "S", lead: "Rohan M. · JEE 2027",
    lines: [
      { who: "visitor", text: "JEE batch ki fees kitni hai?" },
      { who: "bot", text: "JEE Main + Advanced: ₹68,000 per year, payable in 3 instalments. Free demo class every Sunday at 11 AM." },
      { who: "visitor", text: "Can someone call me?" },
      { who: "bot", text: "Of course! I've shared your number with our counsellor. 👍" },
    ],
  },
  {
    business: "SmileCare Dental", initial: "D", lead: "Meena K. · Teeth cleaning",
    lines: [
      { who: "visitor", text: "Are you open on Sunday?" },
      { who: "bot", text: "Yes, Sunday 10 AM to 2 PM. Cleaning starts at ₹800. Shall I book a slot?" },
      { who: "visitor", text: "Yes, tomorrow morning" },
      { who: "bot", text: "Done! Tap “Book a visit” to pick your time. 🦷" },
    ],
  },
];

/** The hero's product stage: a dashboard window and a live chat in 3D, tilting with the cursor and flattening as you scroll. */
export default function HeroStage() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const scrollTilt = useTransform(scrollYProgress, [0.25, 0.6], [16, 0]);
  const scale = useTransform(scrollYProgress, [0.25, 0.6], [0.94, 1]);
  const rx = useSpring(useTransform(() => (reduce ? 0 : scrollTilt.get() - my.get() * 8)), { stiffness: 90, damping: 20 });
  const ry = useSpring(useTransform(() => (reduce ? 0 : mx.get() * 10)), { stiffness: 90, damping: 20 });

  const [script, setScript] = useState(0);
  const [shown, setShown] = useState(0);
  const [lead, setLead] = useState(false);
  const s = SCRIPTS[script];

  // play the conversation, show the lead, then switch business
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    setShown(0);
    setLead(false);
    s.lines.forEach((_, i) => timers.push(setTimeout(() => setShown(i + 1), 900 + i * 1500)));
    timers.push(setTimeout(() => setLead(true), 900 + s.lines.length * 1500));
    timers.push(setTimeout(() => setScript((x) => (x + 1) % SCRIPTS.length), 900 + s.lines.length * 1500 + 3600));
    return () => timers.forEach(clearTimeout);
  }, [script, s.lines]);

  const typing = shown < s.lines.length && s.lines[shown]?.who === "bot";

  return (
    <div className="hs" ref={ref} aria-hidden
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => { mx.set(0); my.set(0); }}>
      <div className="hs-orb o1" /><div className="hs-orb o2" /><div className="hs-orb o3" />
      <motion.div className="hs-tilt" style={{ rotateX: rx, rotateY: ry, scale }}>
        {/* the owner's dashboard */}
        <div className="hs-window">
          <div className="hs-bar"><i /><i /><i /><span>app.kahiye · {s.business}</span></div>
          <div className="hs-body">
            <div className="hs-side">
              <b className="on" /><b /><b /><b /><b />
            </div>
            <div className="hs-main">
              <div className="hs-title">Good evening 👋 <small>sample data</small></div>
              <div className="hs-stats">
                <div><small>Questions answered</small><strong>248</strong><em>+18%</em></div>
                <div><small>New leads</small><strong>{lead ? 13 : 12}</strong><em>this week</em></div>
                <div><small>After office hours</small><strong>64%</strong><em>of chats</em></div>
              </div>
              <div className="hs-leads">
                <AnimatePresence>
                  {lead && (
                    <motion.div className="hs-row new" key={s.lead} initial={{ opacity: 0, x: -20, height: 0 }}
                      animate={{ opacity: 1, x: 0, height: "auto" }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
                      <span className="hs-dot" /> {s.lead} <em>just now</em>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="hs-row"><span className="hs-dot dim" /> Asha P. · NEET <em>2h ago</em></div>
                <div className="hs-row"><span className="hs-dot dim" /> Vikram S. · Foundation <em>yesterday</em></div>
              </div>
            </div>
          </div>
        </div>

        {/* the visitor's chat, floating in front */}
        <div className="hs-chat">
          <div className="hs-chat-head"><span>{s.initial}</span><div><strong>{s.business}</strong><small>● Online · replies instantly</small></div></div>
          <div className="hs-chat-body">
            <AnimatePresence mode="popLayout">
              {s.lines.slice(0, shown).map((l, i) => (
                <motion.div key={`${script}-${i}`} layout className={`hs-msg ${l.who}`}
                  initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}>{l.text}</motion.div>
              ))}
              {typing && <motion.div key="typing" className="hs-msg bot typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><i /><i /><i /></motion.div>}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {lead && (
            <motion.div className="hs-toast" key={`lead-${script}`} initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
              <span className="hs-bell">🔔</span>
              <div><small>New lead · emailed to you</small><strong>{s.lead}</strong></div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hs-chip wa"><span>🟢</span> Also answers on WhatsApp</div>
        <div className="hs-chip lang"><span>अ</span> Hindi · Hinglish · English</div>
      </motion.div>
    </div>
  );
}
