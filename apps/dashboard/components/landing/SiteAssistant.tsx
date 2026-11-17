"use client";

import { useEffect } from "react";
import { gatewayOrigin } from "@/lib/api";
import { site } from "@/lib/site";

/**
 * Kahiye's own assistant on the public website: the real product answering questions about Kahiye (the best demo).
 * Shown only when NEXT_PUBLIC_SITE_BOT_KEY is set; made from /kahiye-assistant.txt in your own account.
 */
export default function SiteAssistant() {
  useEffect(() => {
    if (!site.siteBotKey || document.querySelector("[data-kahiye]")) return;
    const s = document.createElement("script");
    s.src = `${gatewayOrigin()}/widget.js`;
    s.dataset.botKey = site.siteBotKey;
    s.dataset.greeting = "Questions about Kahiye? Ask me, I'm Kahiye's own assistant.";
    s.async = true;
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.querySelectorAll("[data-kahiye]").forEach((el) => el.remove());
    };
  }, []);
  return null;
}
