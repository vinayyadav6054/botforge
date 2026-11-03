import { ChatApi, Turn } from "./api";
import { css } from "./styles";

export interface Options {
  botKey: string;
  apiBase: string;
  accent: string;
}

const CHAT_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const MAX_HISTORY = 10;

export function readOptions(script: HTMLScriptElement | null): Options | null {
  const botKey = script?.dataset.botKey?.trim();
  if (!botKey) {
    console.error("[BotForge] Missing data-bot-key on the widget <script> tag.");
    return null;
  }
  // default API: same origin as the script, under /api (the gateway serves both)
  const origin = script?.src ? new URL(script.src, location.href).origin : location.origin;
  const color = script?.dataset.color;
  const accent = color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#4f46e5";
  return { botKey, apiBase: script?.dataset.api || `${origin}/api`, accent };
}

export function mount(opts: Options): { open: () => void; close: () => void } {
  const api = new ChatApi(opts.apiBase, opts.botKey);
  const historyKey = `botforge:${opts.botKey}:history`;

  const host = document.createElement("div");
  host.setAttribute("data-botforge", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>${css(opts.accent)}</style>
    <button class="launcher" type="button" aria-label="Open chat" aria-expanded="false">${CHAT_ICON}</button>
    <section class="panel" role="dialog" aria-label="Chat" hidden>
      <div class="header"><span class="title">Chat</span><button type="button" class="close" aria-label="Close chat">&times;</button></div>
      <div class="messages" aria-live="polite"></div>
      <form>
        <textarea rows="1" placeholder="Type your question..." aria-label="Message" maxlength="1000"></textarea>
        <button class="send" type="submit">Send</button>
      </form>
      <div class="footer">Powered by BotForge</div>
    </section>`;
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const launcher = $<HTMLButtonElement>(".launcher");
  const panel = $<HTMLElement>(".panel");
  const title = $<HTMLElement>(".title");
  const list = $<HTMLElement>(".messages");
  const form = $<HTMLFormElement>("form");
  const input = $<HTMLTextAreaElement>("textarea");
  const sendBtn = $<HTMLButtonElement>(".send");

  let history: Turn[] = loadHistory(historyKey);
  let busy = false;
  let loaded = false;

  function bubble(kind: "bot" | "user" | "error", text: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text; // never innerHTML: answers may contain text from uploaded documents
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  async function loadInfo() {
    if (loaded) return;
    loaded = true;
    try {
      const info = await api.info();
      title.textContent = info.name;
      if (!history.length) bubble("bot", info.welcomeMessage);
      for (const t of history) bubble(t.role === "user" ? "user" : "bot", t.text);
    } catch {
      bubble("error", "This assistant is not available right now.");
      loaded = false;
    }
  }

  function setOpen(open: boolean) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) {
      void loadInfo();
      setTimeout(() => input.focus(), 0);
    }
  }

  async function send(text: string) {
    busy = true;
    sendBtn.disabled = true;
    bubble("user", text);
    const answer = bubble("bot", "");
    answer.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    let received = "";

    await api.send(text, history.slice(-MAX_HISTORY), {
      onToken: (t) => {
        received += t;
        answer.textContent = received;
        list.scrollTop = list.scrollHeight;
      },
      onError: (message) => {
        if (!received) answer.remove();
        bubble("error", message);
      },
      onDone: () => {
        if (!received) answer.textContent = "Sorry, I don't have an answer for that.";
        const turns: Turn[] = [
          { role: "user", text },
          { role: "assistant", text: answer.textContent ?? "" },
        ];
        history = [...history, ...turns].slice(-MAX_HISTORY);
        saveHistory(historyKey, history);
      },
    });

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  launcher.addEventListener("click", () => setOpen(panel.hidden));
  $<HTMLButtonElement>(".close").addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    void send(text);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") setOpen(false);
  });

  return { open: () => setOpen(true), close: () => setOpen(false) };
}

function loadHistory(key: string): Turn[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Turn => !!t && typeof t.text === "string" && (t.role === "user" || t.role === "assistant"))
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(key: string, history: Turn[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(history));
  } catch {
    /* storage may be blocked; the chat still works without it */
  }
}

// auto-start from the <script data-bot-key="..."> tag
const script = document.currentScript as HTMLScriptElement | null;
const options = script ? readOptions(script) : null;
let instance: ReturnType<typeof mount> | null = null;
if (options) {
  const start = () => (instance = mount(options));
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

export const open = () => instance?.open();
export const close = () => instance?.close();
