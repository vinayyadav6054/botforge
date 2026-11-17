"use client";

import { useEffect, useState } from "react";
import { gatewayOrigin } from "@/lib/api";
import Icon from "@/components/Icon";
import ChatDemo from "./ChatDemo";

/**
 * On the demo website: the real Kahiye widget when a demo bot is configured (NEXT_PUBLIC_DEMO_BOT_KEY),
 * otherwise a floating scripted chat so the page still works without a backend.
 */
export default function DemoWidget({ botKey, color }: { botKey: string; color: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!botKey) return;
    const s = document.createElement("script");
    s.src = `${gatewayOrigin()}/widget.js`;
    s.dataset.botKey = botKey;
    s.dataset.color = color;
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-kahiye]").forEach((el) => el.remove());
    };
  }, [botKey, color]);

  if (botKey) return null;

  return (
    <div className="fake-widget" style={{ ["--w" as string]: color }}>
      {open && (
        <div className="fake-panel" role="dialog" aria-label="Sunrise Assistant (demo)">
          <button className="fake-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
          <ChatDemo initial="coaching" compact />
        </div>
      )}
      <button className="fake-launcher" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close chat" : "Open chat"}>
        {open ? "×" : <Icon name="chat" size={26} />}
      </button>
    </div>
  );
}
