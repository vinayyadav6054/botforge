/** "#abc" / "#0f766e" / "#0f766ecc" -> "#rrggbb" so a 2-digit alpha can be appended safely. */
export function hex6(color: string): string {
  let h = color.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  return `#${h.slice(0, 6)}`;
}

// Accent-dependent colours use color-mix(); browsers without it drop that declaration and keep the solid accent.
export const css = (accent: string) => {
  const a = (alpha: string) => hex6(accent) + alpha;
  return `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
button { font: inherit; }
button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 3px solid ${a("55")}; outline-offset: 2px; }

/* ---------- launcher + greeting ---------- */
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 60px; height: 60px; border-radius: 50%; border: 0; cursor: pointer; color: #fff;
  background-color: ${accent};
  background-image: linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #000));
  box-shadow: 0 10px 24px -6px rgba(17,24,39,.45);
  display: grid; place-items: center; transition: transform .18s ease;
}
.launcher:hover { transform: scale(1.06); }
.launcher svg { transition: transform .2s ease; }
.launcher[aria-expanded="true"] svg { transform: rotate(90deg); }
.launcher.pulse::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid ${accent};
  animation: ring 2.2s ease-out infinite; pointer-events: none;
}
.badge {
  position: absolute; top: -2px; right: -2px; min-width: 19px; height: 19px; border-radius: 99px; padding: 0 5px;
  background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff;
}
.badge[hidden] { display: none; }
.greeting {
  position: fixed; right: 20px; bottom: 92px; z-index: 2147483000; width: 260px; max-width: calc(100vw - 40px);
  background: #fff; color: #1f2328; border-radius: 16px 16px 4px 16px; padding: 13px 14px;
  box-shadow: 0 14px 34px -8px rgba(17,24,39,.35), 0 0 0 1px rgba(17,24,39,.05);
  font-size: 13.5px; line-height: 1.45; cursor: pointer; animation: pop .35s ease-out;
}
.greeting[hidden] { display: none; }
.greeting-text { margin: 0; }
.greeting-close {
  position: absolute; top: -9px; left: -9px; width: 22px; height: 22px; border-radius: 50%; padding: 0;
  background: #6b7280; color: #fff; border: 2px solid #fff; font-size: 13px; line-height: 1; cursor: pointer;
}

/* ---------- panel ---------- */
.panel {
  position: fixed; right: 20px; bottom: 92px; z-index: 2147483000;
  width: 380px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 116px);
  background: #fff; color: #1f2328; border-radius: 20px; overflow: hidden;
  box-shadow: 0 24px 60px -12px rgba(17,24,39,.4), 0 0 0 1px rgba(17,24,39,.05);
  display: flex; flex-direction: column; animation: rise .22s ease-out; transform-origin: bottom right;
}
.panel[hidden] { display: none; }

.header {
  color: #fff; padding: 14px 12px 14px 14px; display: flex; align-items: center; gap: 11px;
  background-color: ${accent};
  background-image: linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #000));
}
.avatar {
  width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; position: relative;
  background: rgba(255,255,255,.2); border: 2px solid rgba(255,255,255,.45);
  display: grid; place-items: center; font-weight: 700; font-size: 15px; letter-spacing: .02em;
}
.avatar::after {
  content: ""; position: absolute; right: -2px; bottom: -2px; width: 11px; height: 11px;
  border-radius: 50%; background: #22c55e; border: 2px solid #fff;
}
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.title { font-weight: 650; font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { font-size: 12px; opacity: .85; }
.icon-btn {
  width: 34px; height: 34px; border-radius: 10px; border: 0; padding: 0; flex-shrink: 0; cursor: pointer;
  background: rgba(255,255,255,.14); color: #fff; display: grid; place-items: center;
}
.icon-btn:hover { background: rgba(255,255,255,.26); }
.icon-btn[hidden] { display: none; }

/* ---------- messages ---------- */
.messages {
  flex: 1; overflow-y: auto; padding: 18px 14px; display: flex; flex-direction: column; gap: 12px;
  background: #f7f8fb;
}
.row { display: flex; gap: 8px; align-items: flex-end; animation: fade .2s ease-out; }
.row.user { justify-content: flex-end; }
.mini {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; color: #fff; font-size: 10px; font-weight: 700;
  display: grid; place-items: center; background: ${accent};
}
.msg {
  max-width: 82%; padding: 10px 13px; border-radius: 16px; font-size: 14px; line-height: 1.5;
  white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;
}
.msg.bot { background: #fff; border-bottom-left-radius: 5px; box-shadow: 0 1px 2px rgba(17,24,39,.06), 0 0 0 1px rgba(17,24,39,.05); }
.msg.user {
  color: #fff; border-bottom-right-radius: 5px; background-color: ${accent};
  background-image: linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 85%, #000));
}
.msg.error { background: #fff4f4; color: #8a1f1f; border-bottom-left-radius: 5px; box-shadow: 0 0 0 1px #f3c2c2; }
.msg.success::before {
  content: "✓"; display: inline-grid; place-items: center; width: 20px; height: 20px; margin-right: 7px;
  border-radius: 50%; background: #dcfce7; color: #16a34a; font-weight: 700; font-size: 12px; vertical-align: -4px;
}

.chips { display: flex; flex-wrap: wrap; gap: 7px; padding-left: 34px; animation: fade .25s ease-out; }
.chip {
  font-size: 13px; font-weight: 500; padding: 7px 12px; border-radius: 99px; cursor: pointer; text-align: left;
  background: #fff; color: ${accent}; border: 1.5px solid ${a("59")}; line-height: 1.3;
}
.chip:hover { background: ${a("12")}; border-color: ${accent}; }

.msg.note { background: transparent; box-shadow: none; color: #6b7280; font-size: 12.5px; font-style: italic; padding: 4px 6px; }
.msg.agent { box-shadow: 0 0 0 1.5px ${a("55")}; }
.with-person .status::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; margin-right: 6px; vertical-align: 1px; }

.actions { display: flex; gap: 6px; padding: 8px 12px 0; overflow-x: auto; scrollbar-width: none; }
.actions::-webkit-scrollbar { display: none; }
.action {
  flex: none; font-size: 13px; font-weight: 600; padding: 7px 13px; border-radius: 99px; text-decoration: none;
  background: ${a("12")}; color: ${accent}; border: 1.5px solid ${a("40")}; white-space: nowrap; line-height: 1.3;
  transition: background .15s, color .15s;
}
.action:hover { background: ${accent}; color: #fff; }
.action.booking::before { content: "\\1F4C5"; margin-right: 6px; }
.action.payment::before, .action.upi::before { content: "\\20B9"; margin-right: 5px; font-weight: 800; }

.msg-loading { padding: 10px 13px; border-radius: 16px; background: #fff; box-shadow: 0 0 0 1px rgba(17,24,39,.05); }
.typing { display: inline-flex; gap: 4px; padding: 4px 2px; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: #b3b9c4; animation: bounce 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }

/* ---------- composer ---------- */
form.composer { padding: 10px 12px 0; background: #fff; border-top: 1px solid #eceef3; }
.pill {
  display: flex; align-items: flex-end; gap: 6px; background: #f3f4f8; border-radius: 22px;
  padding: 5px 5px 5px 16px; border: 1.5px solid transparent; transition: border-color .15s, background .15s;
}
.pill:focus-within { border-color: ${a("73")}; background: #fff; }
textarea {
  flex: 1; resize: none; border: 0; outline: none; background: transparent; color: inherit;
  font-size: 14px; line-height: 1.45; padding: 7px 0; max-height: 96px;
}
textarea:focus-visible { outline: none; }
.send {
  width: 36px; height: 36px; border-radius: 50%; border: 0; padding: 0; flex-shrink: 0; cursor: pointer; color: #fff;
  background: ${accent}; display: grid; place-items: center; transition: transform .15s, opacity .15s;
}
.send:hover:not(:disabled) { transform: scale(1.06); }
.send:disabled { opacity: .45; cursor: default; }
.footer { text-align: center; font-size: 10.5px; color: #a3a9b5; padding: 7px 0 9px; background: #fff; }
.footer[hidden] { display: none; }
.footer a { color: inherit; text-decoration: none; }
.footer a:hover { text-decoration: underline; }

/* ---------- lead card ---------- */
.lead {
  margin-left: 34px; background: #fff; border-radius: 16px; padding: 16px; border-top: 4px solid ${accent};
  box-shadow: 0 1px 2px rgba(17,24,39,.06), 0 0 0 1px rgba(17,24,39,.05);
  display: flex; flex-direction: column; gap: 9px; animation: fade .25s ease-out;
}
.lead-intro { margin: 0 0 2px; font-size: 15px; font-weight: 650; line-height: 1.4; }
.lead-field { display: flex; flex-direction: column; gap: 4px; color: #5d6374; font-size: 11.5px; font-weight: 600; }
.lead-field input {
  font-size: 14px; font-weight: 400; padding: 10px 12px; border-radius: 10px; color: #1f2328;
  border: 1.5px solid #e1e4ea; background: #fafbfc; transition: border-color .15s, background .15s;
}
.lead-field input:focus { outline: none; border-color: ${accent}; background: #fff; }
.lead-trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.lead-error { margin: 0; font-size: 12.5px; color: #b42318; }
.lead-error[hidden] { display: none; }
.lead-actions { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
.lead-submit {
  width: 100%; border: 0; border-radius: 11px; padding: 11px; font-size: 14px; font-weight: 600; color: #fff; cursor: pointer;
  background: ${accent};
}
.lead-submit:hover:not(:disabled) { filter: brightness(1.08); }
.lead-submit:disabled { opacity: .6; cursor: default; }
.lead-skip { border: 0; background: transparent; color: #7a8190; cursor: pointer; font-size: 12.5px; padding: 6px; }
.lead-skip:hover { color: #1f2328; }
.lead-consent { margin: 0; font-size: 10.5px; color: #9aa1ad; line-height: 1.4; text-align: center; }

@keyframes rise { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes rec { 0%, 100% { box-shadow: 0 0 0 0 rgba(229,72,77,.5); } 50% { box-shadow: 0 0 0 6px rgba(229,72,77,0); } }
@keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes ring { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.45); opacity: 0; } }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}

/* phones: the chat takes the whole screen */
@media (max-width: 480px) {
  .panel { right: 0; bottom: 0; width: 100vw; max-width: 100vw; height: 100%; max-height: 100%; border-radius: 0; }
  .launcher[aria-expanded="true"] { display: none; }
  .greeting { right: 16px; }
}

/* voice: microphone in the composer, read-aloud toggle in the header */
.mic {
  width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0; flex-shrink: 0; cursor: pointer;
  background: transparent; color: #7a8190; display: grid; place-items: center;
}
.mic:hover { color: ${accent}; }
.mic[hidden], .speak[hidden] { display: none; }
.mic.recording { background: #e5484d; color: #fff; animation: rec 1.2s ease-in-out infinite; }
.speak[aria-pressed="true"] { background: rgba(255,255,255,.34); }

/* owner settings: left placement, logo, opening hours, sources under answers */
.launcher.left, .greeting.left, .panel.left { right: auto; left: 20px; }
.panel.left { transform-origin: bottom left; }
@media (max-width: 480px) { .panel.left { left: 0; } .greeting.left { left: 16px; } }
.avatar img, .mini img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
.mini.logo { background: #fff; box-shadow: 0 0 0 1px rgba(17,24,39,.08); overflow: hidden; }
.hours { padding: 8px 14px; font-size: 12.5px; line-height: 1.4; background: #fff8e6; color: #7a5300; border-bottom: 1px solid #f1e3bd; }
.hours[hidden] { display: none; }
.sources { margin: -6px 0 0 34px; font-size: 11.5px; color: #7a8190; animation: fade .2s ease-out; }
.sources a { color: inherit; text-decoration: underline; }

@media (prefers-color-scheme: dark) {
  .panel, .greeting { background: #1c1f24; color: #e6e8eb; }
  .hours { background: #2f2611; color: #f0c36b; border-color: #4a3c18; }
  .sources { color: #a8b0ba; }
  .greeting { box-shadow: 0 14px 34px -8px rgba(0,0,0,.6), 0 0 0 1px #343a43; }
  .messages { background: #15171b; }
  .msg.bot, .msg-loading { background: #23272e; box-shadow: 0 0 0 1px #343a43; }
  .msg.error { background: #3a1d1d; color: #ffb4b4; box-shadow: 0 0 0 1px #6b2b2b; }
  .chip { background: #23272e; }
  form.composer, .footer { background: #1c1f24; border-color: #2c3139; }
  .pill, .pill:focus-within { background: #15171b; }
  .lead { background: #23272e; box-shadow: 0 0 0 1px #343a43; }
  .lead-field { color: #a8b0ba; }
  .lead-field input, .lead-field input:focus { background: #15171b; color: #e6e8eb; }
  .lead-field input { border-color: #3a414b; }
  .lead-skip { color: #a8b0ba; }
  .lead-skip:hover { color: #e6e8eb; }
  .lead-error { color: #ff9b9b; }
}
`;
};
