export const css = (accent: string) => `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer;
  background: ${accent}; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25);
  display: grid; place-items: center; transition: transform .15s ease;
}
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible { outline: 3px solid ${accent}55; outline-offset: 2px; }
.panel {
  position: fixed; right: 20px; bottom: 88px; z-index: 2147483000;
  width: 370px; max-width: calc(100vw - 32px); height: 540px; max-height: calc(100vh - 120px);
  background: #fff; color: #1f2328; border-radius: 16px; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,.22); display: flex; flex-direction: column;
}
.panel[hidden] { display: none; }
.header { background: ${accent}; color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
.header .title { font-weight: 600; font-size: 15px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header button { background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 20px; line-height: 1; padding: 4px; border-radius: 6px; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f6f7f9; }
.msg { max-width: 85%; padding: 9px 12px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
.msg.bot { align-self: flex-start; background: #fff; border: 1px solid #e3e6ea; border-bottom-left-radius: 4px; }
.msg.user { align-self: flex-end; background: ${accent}; color: #fff; border-bottom-right-radius: 4px; }
.msg.error { align-self: flex-start; background: #fff4f4; border: 1px solid #f3c2c2; color: #8a1f1f; }
.typing { display: inline-flex; gap: 4px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: #9aa1a9; animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e3e6ea; background: #fff; }
textarea { flex: 1; resize: none; border: 1px solid #d0d5db; border-radius: 10px; padding: 9px 10px; font-size: 14px; max-height: 96px; color: inherit; background: #fff; }
.send { border: 0; border-radius: 10px; padding: 0 14px; background: ${accent}; color: #fff; font-weight: 600; cursor: pointer; }
.send:disabled { opacity: .5; cursor: default; }
.footer { text-align: center; font-size: 11px; color: #8b939c; padding: 0 0 8px; background: #fff; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1c1f24; color: #e6e8eb; }
  .messages { background: #15171b; }
  .msg.bot { background: #23272e; border-color: #343a43; }
  form, .footer { background: #1c1f24; border-color: #343a43; }
  textarea { background: #15171b; border-color: #3a414b; }
}
`;
