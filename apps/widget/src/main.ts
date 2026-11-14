import { BotInfo, ChatAction, ChatApi, LeadCapture, OpeningHours, SourceRef, Turn } from "./api";
import { fill, pickLanguage, speechLang, Texts, TEXTS } from "./i18n";
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
const MIC_ICON = svg(18, 2.2, '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const SPEAKER_ICON = svg(17, 2.2, '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>');
const MAX_RECORDING_MS = 30_000;
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
  const conversationKey = `botforge:${opts.botKey}:conversation`;

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
        <button type="button" class="icon-btn speak" aria-label="Read answers aloud" title="Read answers aloud" aria-pressed="false" hidden>${SPEAKER_ICON}</button>
        <button type="button" class="icon-btn talk" aria-label="Request a call back" title="Request a call back" hidden>${PHONE_ICON}</button>
        <button type="button" class="icon-btn close" aria-label="Close chat">${SMALL_CLOSE_ICON}</button>
      </div>
      <div class="hours" role="status" hidden></div>
      <div class="messages" aria-live="polite"></div>
      <div class="actions" role="group" aria-label="Quick actions" hidden></div>
      <form class="composer">
        <div class="pill">
          <textarea rows="1" placeholder="Type your question…" aria-label="Message" maxlength="1000"></textarea>
          <button class="mic" type="button" aria-label="Speak your question" title="Speak your question" hidden>${MIC_ICON}</button>
          <button class="send" type="submit" aria-label="Send">${SEND_ICON}</button>
        </div>
      </form>
      <div class="footer" hidden></div>
    </section>`;
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const launcher = $<HTMLButtonElement>(".launcher");
  const panel = $<HTMLElement>(".panel");
  const title = $<HTMLElement>(".title");
  const list = $<HTMLElement>(".messages");
  const form = $<HTMLFormElement>("form.composer");
  const talk = $<HTMLButtonElement>(".talk");
  const actionBar = $<HTMLElement>(".actions");
  const input = $<HTMLTextAreaElement>("textarea");
  const sendBtn = $<HTMLButtonElement>(".send");
  const avatar = $<HTMLElement>(".avatar");
  const greeting = $<HTMLElement>(".greeting");
  const badge = $<HTMLElement>(".badge");
  const footer = $<HTMLElement>(".footer");
  const hoursBar = $<HTMLElement>(".hours");
  const micBtn = $<HTMLButtonElement>(".mic");
  const speakBtn = $<HTMLButtonElement>(".speak");
  const status = $<HTMLElement>(".status");
  let T: Texts = TEXTS.en;
  let uiLang = "en";
  let speakAnswers = false;
  let recorder: MediaRecorder | null = null;
  const styleEl = root.querySelector("style")!;
  let logo = "";   // the owner's logo (data: URL), used instead of initials

  // bot settings are fetched right away, so colour, side and logo are right before the visitor opens the chat
  let infoPromise: Promise<BotInfo> | null = null;
  const getInfo = () =>
    (infoPromise ??= api.info().catch((e) => {
      infoPromise = null;   // try again when the chat is opened
      throw e;
    }));
  getInfo().then(applyLook).catch(() => undefined);

  function applyTexts(info: BotInfo) {
    uiLang = pickLanguage(info.language, typeof navigator !== "undefined" ? navigator.language : "en");
    T = TEXTS[uiLang];
    input.placeholder = T.placeholder;
    status.textContent = T.online;
    const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
    micBtn.hidden = info.voice === false || !canRecord;
    speakBtn.hidden = info.voice === false || typeof speechSynthesis === "undefined";
  }

  function applyLook(info: BotInfo) {
    applyTexts(info);
    const look = info.appearance;
    if (look?.color && /^#[0-9a-f]{6}$/i.test(look.color)) styleEl.textContent = css(look.color);
    const left = look?.position === "left";
    for (const el of [launcher, panel, greeting]) el.classList.toggle("left", left);
    if (look?.avatar && /^data:image\/(png|jpeg|webp);base64,/.test(look.avatar)) {
      logo = look.avatar;
      avatar.textContent = "";
      const img = document.createElement("img");
      img.src = logo;
      img.alt = "";
      avatar.appendChild(img);
    }
  }

  let history: Turn[] = loadHistory(historyKey);
  let busy = false;
  let infoPending: Promise<void> | null = null; // settled once the welcome message is shown
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
      if (logo) {
        mini.classList.add("logo");
        const img = document.createElement("img");
        img.src = logo;
        img.alt = "";
        mini.appendChild(img);
      } else if (short) mini.textContent = short;
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

  function showBranding(branding: BotInfo["branding"]) {
    if (branding?.show === false) return;
    const url = typeof branding?.url === "string" && /^https?:\/\//i.test(branding.url) ? branding.url : "";
    const label = "⚡ Powered by BotForge";
    footer.textContent = "";
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      footer.appendChild(a);
    } else {
      footer.textContent = label;
    }
    footer.hidden = false;
  }

  let spokenQuestion = false;   // a question asked by voice gets its answer read aloud

  function speak(text: string) {
    if (typeof speechSynthesis === "undefined" || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(text, uiLang);
    speechSynthesis.speak(u);
  }

  async function toggleRecording() {
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      bubble("error", T.micError);
      return;
    }
    const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(limit);
      recorder = null;
      micBtn.classList.remove("recording");
      input.placeholder = T.placeholder;
      const text = await api.transcribe(new Blob(parts, { type: rec.mimeType || type || "audio/webm" }));
      if (!text) {
        bubble("error", T.voiceFailed);
        return;
      }
      spokenQuestion = true;
      ask(text);
    };
    const limit = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_RECORDING_MS);
    recorder = rec;
    rec.start();
    micBtn.classList.add("recording");
    input.placeholder = T.listening;
  }

  function showHours(hours: OpeningHours | undefined) {
    if (!hours?.enabled || !hours.message || isOpenNow(hours, new Date())) return;
    hoursBar.textContent = hours.message;
    hoursBar.hidden = false;
  }

  function showSources(items: SourceRef[]) {
    const valid = items.filter((s) => s && typeof s.name === "string").slice(0, 3);
    if (!valid.length) return;
    const line = document.createElement("div");
    line.className = "sources";
    line.append(`${valid.length > 1 ? T.sources : T.source}: `);
    valid.forEach((s, i) => {
      if (i) line.append(" · ");
      const label = s.location ? `${s.name} (${s.location})` : s.name;
      if (s.url && /^https?:\/\//i.test(s.url)) {
        const a = document.createElement("a");
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = label;
        line.appendChild(a);
      } else {
        line.append(label);
      }
    });
    list.appendChild(line);
    list.scrollTop = list.scrollHeight;
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

  function loadInfo(): Promise<void> {
    if (!infoPending) infoPending = fetchInfo();
    return infoPending;
  }

  async function fetchInfo() {
    // typing dots while the bot loads, so the panel never looks empty on a slow connection
    const loading = document.createElement("div");
    loading.className = "row bot loading";
    loading.innerHTML = '<div class="msg-loading"><span class="typing"><span></span><span></span><span></span></span></div>';
    list.appendChild(loading);
    try {
      const info = await getInfo();
      applyLook(info);
      showHours(info.hours);
      loading.remove();
      botName = info.name;
      title.textContent = info.name;
      short = initials(info.name);
      if (short) avatar.textContent = short;
      lead = info.leadCapture?.enabled ? info.leadCapture : null;
      showBranding(info.branding);
      showActions(info.actions);
      talk.hidden = !lead || leadState === "done";
      if (!history.length) {
        bubble("bot", info.welcomeMessage);
        const questions = Array.isArray(info.suggestedQuestions) ? info.suggestedQuestions : [];
        showChips(questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 4));
      }
      for (const t of history) bubble(t.role === "user" ? "user" : "bot", t.text);
      if (lead?.timing === "start" && !leadState && !history.length) showLeadForm();
    } catch {
      loading.remove();
      bubble("error", T.unavailable);
      infoPending = null;
    }
  }

  // ---------- action buttons: book a visit, pay fees, pay by UPI ----------
  function showActions(actions: ChatAction[] | undefined) {
    actionBar.textContent = "";
    for (const a of Array.isArray(actions) ? actions.slice(0, 3) : []) {
      if (!a || typeof a.label !== "string" || typeof a.url !== "string") continue;
      const safe = a.kind === "upi" ? a.url.startsWith("upi://pay?") : /^https?:\/\//i.test(a.url);
      if (!safe) continue;
      const link = document.createElement("a");
      link.className = `action ${a.kind}`;
      link.textContent = a.label; // text, never HTML
      link.href = a.url;
      if (a.kind === "upi") {
        if (a.upiId) link.title = `UPI: ${a.upiId}`;
        // upi:// links only open on phones; on a computer, copy the UPI ID instead
        link.addEventListener("click", (e) => {
          if (window.matchMedia?.("(pointer: coarse)").matches || !a.upiId) return;
          e.preventDefault();
          void navigator.clipboard?.writeText(a.upiId).catch(() => undefined);
          bubble("bot", fill(T.upiCopied, a.upiId));
        });
      } else {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      actionBar.appendChild(link);
    }
    actionBar.hidden = !actionBar.childElementCount;
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
      onSources: (items) => showSources(items),
      onDone: () => {
        if (!received) answer.textContent = T.noAnswer;
        if (speakAnswers || spokenQuestion) speak(answer.textContent ?? "");
        spokenQuestion = false;
        const turns: Turn[] = [
          { role: "user", text },
          { role: "assistant", text: answer.textContent ?? "" },
        ];
        history = [...history, ...turns].slice(-MAX_HISTORY);
        saveHistory(historyKey, history);
        answered += 1;
        maybeOfferLead();
      },
    }, { conversationId: conversationId(conversationKey), pageUrl: location.origin + location.pathname });

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ---------- lead capture ----------
  function maybeOfferLead() {
    // "button" (or afterMessages 0): only when the visitor clicks the call-back button; "start": shown on open
    if (!lead || leadState || leadCard || lead.timing === "button" || lead.timing === "start" || lead.afterMessages <= 0) return;
    if (answered >= lead.afterMessages) showLeadForm();
  }

  function field(name: string, label: string, type: string, required: boolean, autocomplete: AutoFill) {
    const wrap = document.createElement("label");
    wrap.className = "lead-field";
    const span = document.createElement("span");
    span.textContent = required ? label : `${label} (${T.optional})`;
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

    const name = field("name", T.name, "text", true, "name");
    const phone = field("phone", T.phone, "tel", true, "tel");
    const course = field("course", lead.courseLabel || "Course / interest", "text", false, "off");
    const email = field("email", T.email, "email", false, "email");
    email.input.placeholder = "e.g. asha@example.com";
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
    consent.textContent = fill(T.consent, botName || "we");
    const error = document.createElement("p");
    error.className = "lead-error";
    error.setAttribute("role", "alert");
    error.hidden = true;

    const actions = document.createElement("div");
    actions.className = "lead-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "lead-submit";
    submit.textContent = T.submit;
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "lead-skip";
    skip.textContent = T.skip;
    actions.append(submit, skip);

    card.append(intro, name.wrap, phone.wrap);
    if (lead.askEmail) card.append(email.wrap);
    if (lead.askCourse !== false) card.append(course.wrap);
    card.append(trap, consent, error, actions);
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
      if (!n) return showError(T.needName);
      if (p.replace(/\D/g, "").length < 8) return showError(T.needPhone);
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = T.sending;

      const problem = await api.submitLead({
        name: n,
        phone: p,
        course: course.input.value.trim() || undefined,
        email: email.input.value.trim() || undefined,
        pageUrl: location.href,
        transcript: history,
        website: trap.value || undefined,
      });

      if (problem) {
        submit.disabled = false;
        submit.textContent = T.submit;
        return showError(problem);
      }
      card.remove();
      leadCard = null;
      setLeadState("done");
      talk.hidden = true;
      bubble("bot", fill(T.thanks, n)).classList.add("success");
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
    // after the welcome message, so a question asked before the chat was ever opened stays in order
    void loadInfo().then(() => {
      if (!busy) void send(q);
    });
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
    // the default greeting follows the bot's language once its settings have loaded
    if (opts.greeting === DEFAULT_GREETING)
      getInfo().then(() => ($<HTMLElement>(".greeting-text").textContent = T.greeting)).catch(() => undefined);
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
  speakBtn.addEventListener("click", () => {
    speakAnswers = !speakAnswers;
    speakBtn.setAttribute("aria-pressed", String(speakAnswers));
    if (!speakAnswers && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  });
  micBtn.addEventListener("click", () => void toggleRecording());
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

/** One id per visitor session and bot; kept in sessionStorage so a page reload continues the same conversation. */
export function conversationId(key: string): string {
  const existing = loadFlag(key);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = newUuid();
  saveFlag(key, id);
  return id;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Is the business open now, in its own time zone? (Visitors may be anywhere.) */
export function isOpenNow(hours: OpeningHours, now: Date): boolean {
  let weekday = "", time = "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: hours.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    time = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`.replace(/^24/, "00");
  } catch {
    return true;   // unknown time zone: never claim to be closed
  }
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 1;
  if (!hours.days.includes(day)) return false;
  return hours.start <= hours.end
    ? time >= hours.start && time < hours.end
    : time >= hours.start || time < hours.end;   // e.g. 18:00-02:00
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
