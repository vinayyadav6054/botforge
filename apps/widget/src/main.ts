import { ChatApi, LeadCapture, Turn } from "./api";
import { css } from "./styles";

export interface Options {
  botKey: string;
  apiBase: string;
  accent: string;
  /** Text of the small bubble next to the closed chat button; null turns it off. */
  greeting?: string | null;
}

const svg = (size: number, width: number, body: string) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const BUBBLE_PATH = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
const CHAT_ICON = svg(27, 2, BUBBLE_PATH);
const MINI_CHAT_ICON = svg(14, 2.4, BUBBLE_PATH);
const CLOSE_ICON = svg(24, 2.4, '<path d="M18 6 6 18M6 6l12 12"/>');
const SMALL_CLOSE_ICON = svg(17, 2.4, '<path d="M18 6 6 18M6 6l12 12"/>');
const SEND_ICON = svg(17, 2.4, '<path d="M5 12h14M13 6l6 6-6 6"/>');
const PHONE_ICON = svg(17, 2,
  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>');
const MAX_HISTORY = 10;
const DEFAULT_GREETING = "👋 Hi! Have a question? Ask me here, I reply instantly.";
const GREETING_DELAY_MS = 4000;

/** "Kalrashukla Classes" -> "KC", "bakery" -> "B"; empty when the name has no letters or digits. */
export function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
}

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
  const g = script?.dataset.greeting?.trim();
  const greeting = g === "off" ? null : (g || DEFAULT_GREETING).slice(0, 160);
  return { botKey, apiBase: script?.dataset.api || `${origin}/api`, accent, greeting };
}

export interface Widget {
  open: () => void;
  close: () => void;
  /** Opens the chat and sends a question, as if the visitor typed it. */
  ask: (text: string) => void;
}

export function mount(opts: Options): Widget {
  const api = new ChatApi(opts.apiBase, opts.botKey);
  const historyKey = `botforge:${opts.botKey}:history`;
  const leadKey = `botforge:${opts.botKey}:lead`;
  const greetingKey = `botforge:${opts.botKey}:greeted`;

  const host = document.createElement("div");
  host.setAttribute("data-botforge", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>${css(opts.accent)}</style>
    <div class="greeting" role="status" hidden>
      <button type="button" class="greeting-close" aria-label="Dismiss greeting">&times;</button>
      <p class="greeting-text"></p>
    </div>
    <button class="launcher" type="button" aria-label="Open chat" aria-expanded="false">${CHAT_ICON}<span class="badge" aria-hidden="true" hidden>1</span></button>
    <section class="panel" role="dialog" aria-label="Chat" hidden>
      <div class="header">
        <div class="avatar" aria-hidden="true">${MINI_CHAT_ICON}</div>
        <div class="who"><span class="title">Chat</span><span class="status">Online · replies instantly</span></div>
        <button type="button" class="icon-btn talk" aria-label="Request a call back" title="Request a call back" hidden>${PHONE_ICON}</button>
        <button type="button" class="icon-btn close" aria-label="Close chat">${SMALL_CLOSE_ICON}</button>
      </div>
      <div class="messages" aria-live="polite"></div>
      <form class="composer">
        <div class="pill">
          <textarea rows="1" placeholder="Type your question…" aria-label="Message" maxlength="1000"></textarea>
          <button class="send" type="submit" aria-label="Send">${SEND_ICON}</button>
        </div>
      </form>
      <div class="footer">⚡ Powered by BotForge</div>
    </section>`;
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const launcher = $<HTMLButtonElement>(".launcher");
  const panel = $<HTMLElement>(".panel");
  const title = $<HTMLElement>(".title");
  const list = $<HTMLElement>(".messages");
  const form = $<HTMLFormElement>("form.composer");
  const talk = $<HTMLButtonElement>(".talk");
  const input = $<HTMLTextAreaElement>("textarea");
  const sendBtn = $<HTMLButtonElement>(".send");
  const avatar = $<HTMLElement>(".avatar");
  const greeting = $<HTMLElement>(".greeting");
  const badge = $<HTMLElement>(".badge");

  let history: Turn[] = loadHistory(historyKey);
  let busy = false;
  let loaded = false;
  let botName = "";
  let lead: LeadCapture | null = null;
  let leadState = loadFlag(leadKey); // "done" | "dismissed" | null
  let leadCard: HTMLFormElement | null = null;
  let answered = history.filter((t) => t.role === "assistant").length;
  let short = ""; // the bot's initials, shown in the avatars
  let chips: HTMLDivElement | null = null;

  /** Adds a message row and returns its bubble; bot rows get a small avatar. */
  function bubble(kind: "bot" | "user" | "error", text: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = `row ${kind === "user" ? "user" : "bot"}`;
    if (kind !== "user") {
      const mini = document.createElement("div");
      mini.className = "mini";
      mini.setAttribute("aria-hidden", "true");
      if (short) mini.textContent = short;
      else mini.innerHTML = MINI_CHAT_ICON;
      row.appendChild(mini);
    }
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text; // never innerHTML: answers may contain text from uploaded documents
    row.appendChild(el);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  function showChips(questions: string[]) {
    if (!questions.length) return;
    chips = document.createElement("div");
    chips.className = "chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Suggested questions");
    for (const q of questions) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = q;
      b.addEventListener("click", () => ask(q));
      chips.appendChild(b);
    }
    list.appendChild(chips);
  }

  function hideChips() {
    chips?.remove();
    chips = null;
  }

  async function loadInfo() {
    if (loaded) return;
    loaded = true;
    // typing dots while the bot loads, so the panel never looks empty on a slow connection
    const loading = document.createElement("div");
    loading.className = "row bot loading";
    loading.innerHTML = '<div class="msg-loading"><span class="typing"><span></span><span></span><span></span></span></div>';
    list.appendChild(loading);
    try {
      const info = await api.info();
      loading.remove();
      botName = info.name;
      title.textContent = info.name;
      short = initials(info.name);
      if (short) avatar.textContent = short;
      lead = info.leadCapture?.enabled ? info.leadCapture : null;
      talk.hidden = !lead || leadState === "done";
      if (!history.length) {
        bubble("bot", info.welcomeMessage);
        const questions = Array.isArray(info.suggestedQuestions) ? info.suggestedQuestions : [];
        showChips(questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 4));
      }
      for (const t of history) bubble(t.role === "user" ? "user" : "bot", t.text);
    } catch {
      loading.remove();
      bubble("error", "This assistant is not available right now.");
      loaded = false;
    }
  }

  function setOpen(open: boolean) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    launcher.appendChild(badge);
    if (open) {
      hideGreeting();
      void loadInfo();
      setTimeout(() => input.focus(), 0);
    }
  }

  async function send(text: string) {
    busy = true;
    sendBtn.disabled = true;
    hideChips();
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
        if (!received) answer.parentElement?.remove();
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
        answered += 1;
        maybeOfferLead();
      },
    });

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ---------- lead capture ----------
  function maybeOfferLead() {
    // afterMessages 0 means: only when the visitor clicks "Talk to us"
    if (!lead || leadState || leadCard || lead.afterMessages <= 0) return;
    if (answered >= lead.afterMessages) showLeadForm();
  }

  function field(name: string, label: string, type: string, required: boolean, autocomplete: AutoFill) {
    const wrap = document.createElement("label");
    wrap.className = "lead-field";
    const span = document.createElement("span");
    span.textContent = required ? label : `${label} (optional)`;
    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    input.required = required;
    input.autocomplete = autocomplete;
    input.maxLength = name === "phone" ? 20 : 100;
    wrap.append(span, input);
    return { wrap, input };
  }

  function showLeadForm() {
    if (!lead) return;
    if (leadCard) {
      leadCard.scrollIntoView?.({ block: "nearest" });
      leadCard.querySelector("input")?.focus();
      return;
    }
    const card = document.createElement("form");
    card.className = "lead";
    card.noValidate = true;
    const intro = document.createElement("p");
    intro.className = "lead-intro";
    intro.textContent = lead.prompt;

    const name = field("name", "Your name", "text", true, "name");
    const phone = field("phone", "Phone number", "tel", true, "tel");
    const course = field("course", "Course / interest", "text", false, "off");
    name.input.placeholder = "e.g. Asha Patil";
    phone.input.placeholder = "e.g. 98200 12345";
    phone.input.inputMode = "tel";
    // honeypot: invisible to people, tempting to bots
    const trap = document.createElement("input");
    trap.name = "website";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.className = "lead-trap";
    trap.setAttribute("aria-hidden", "true");

    const consent = document.createElement("p");
    consent.className = "lead-consent";
    consent.textContent = `By submitting, you agree ${botName || "we"} may contact you about your enquiry.`;
    const error = document.createElement("p");
    error.className = "lead-error";
    error.setAttribute("role", "alert");
    error.hidden = true;

    const actions = document.createElement("div");
    actions.className = "lead-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "lead-submit";
    submit.textContent = "Request a call back";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "lead-skip";
    skip.textContent = "No thanks, keep chatting";
    actions.append(submit, skip);

    card.append(intro, name.wrap, phone.wrap, course.wrap, trap, consent, error, actions);
    list.appendChild(card);
    list.scrollTop = list.scrollHeight;
    leadCard = card;

    const showError = (msg: string) => {
      error.textContent = msg;
      error.hidden = false;
    };

    skip.addEventListener("click", () => {
      card.remove();
      leadCard = null;
      if (!leadState) setLeadState("dismissed");
    });

    card.addEventListener("submit", async (e) => {
      e.preventDefault();
      const n = name.input.value.trim();
      const p = phone.input.value.trim();
      if (!n) return showError("Please enter your name.");
      if (p.replace(/\D/g, "").length < 8) return showError("Please enter a valid phone number.");
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Sending...";

      const problem = await api.submitLead({
        name: n,
        phone: p,
        course: course.input.value.trim() || undefined,
        pageUrl: location.href,
        transcript: history,
        website: trap.value || undefined,
      });

      if (problem) {
        submit.disabled = false;
        submit.textContent = "Request a call back";
        return showError(problem);
      }
      card.remove();
      leadCard = null;
      setLeadState("done");
      talk.hidden = true;
      bubble("bot", `Thank you, ${n}! Our team will contact you soon.`).classList.add("success");
    });

    setTimeout(() => name.input.focus(), 0);
  }

  function setLeadState(state: "done" | "dismissed") {
    leadState = state;
    saveFlag(leadKey, state);
  }

  function ask(text: string) {
    setOpen(true);
    const q = text.trim().slice(0, 1000);
    if (!q || busy) return;
    void send(q);
  }

  // ---------- greeting bubble: once per visit, only while the chat has not been opened ----------
  function hideGreeting() {
    greeting.hidden = true;
    badge.hidden = true;
    launcher.classList.remove("pulse");
    saveFlag(greetingKey, "1"); // opened or dismissed: do not show it again this visit
  }

  if (opts.greeting && !loadFlag(greetingKey)) {
    $<HTMLElement>(".greeting-text").textContent = opts.greeting;
    setTimeout(() => {
      if (!panel.hidden || loadFlag(greetingKey)) return;
      saveFlag(greetingKey, "1");
      greeting.hidden = false;
      badge.hidden = false;
      launcher.classList.add("pulse");
    }, GREETING_DELAY_MS);
  }
  greeting.addEventListener("click", () => setOpen(true));
  $<HTMLButtonElement>(".greeting-close").addEventListener("click", (e) => {
    e.stopPropagation();
    hideGreeting();
  });

  talk.addEventListener("click", () => showLeadForm());
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

  return { open: () => setOpen(true), close: () => setOpen(false), ask };
}

function loadFlag(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveFlag(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage may be blocked; the visitor may just be asked again */
  }
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
export const ask = (text: string) => instance?.ask(text);
