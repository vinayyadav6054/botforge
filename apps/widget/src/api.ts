import { SseParser } from "./sse";

export interface LeadCapture {
  enabled: boolean;
  prompt: string;
  afterMessages: number;
  /** when the form opens: after N answers, at the start of the chat, or only from the call-back button */
  timing?: "after" | "start" | "button";
  askEmail?: boolean;
  askCourse?: boolean;
  courseLabel?: string;
}

export interface Appearance {
  color?: string | null;
  position?: "left" | "right";
  /** data:image/... logo */
  avatar?: string | null;
}

export interface OpeningHours {
  enabled: boolean;
  start: string;
  end: string;
  /** 1 = Monday ... 7 = Sunday */
  days: number[];
  timeZone: string;
  message: string;
}

export interface SourceRef {
  name: string;
  location?: string | null;
  url?: string | null;
}

export interface BotInfo {
  name: string;
  welcomeMessage: string;
  leadCapture?: LeadCapture;
  suggestedQuestions?: string[];
  /** "Powered by Kahiye": shown unless the business's plan removes it */
  branding?: { show?: boolean; url?: string };
  appearance?: Appearance;
  hours?: OpeningHours;
  /** "auto" or a language code: the widget's own texts follow it */
  language?: string;
  /** microphone and read-aloud buttons */
  voice?: boolean;
  /** the business's buttons: book a visit, pay fees, pay by UPI */
  actions?: ChatAction[];
}

export interface ChatAction {
  kind: "booking" | "payment" | "upi";
  label: string;
  url: string;
  upiId?: string;
}

/** Sent with every message so the owner sees the whole visit as one conversation. */
export interface SendContext {
  conversationId?: string;
  pageUrl?: string;
}

export interface LeadInput {
  name: string;
  phone: string;
  course?: string;
  email?: string;
  pageUrl?: string;
  transcript: Turn[];
  website?: string; // honeypot
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
  /** where the answer came from (sent after the answer when the owner enabled it) */
  onSources?: (items: SourceRef[]) => void;
  /** a person from the business is handling this chat: no bot answer comes */
  onHandover?: () => void;
}

/** A person's replies since the last check, and whether they are still handling the chat. */
export interface HandoverUpdates {
  human: boolean;
  messages: { text: string; at: string }[];
}

export class ChatApi {
  constructor(private readonly apiBase: string, private readonly botKey: string) {}

  private url(suffix = ""): string {
    return `${this.apiBase.replace(/\/+$/, "")}/chat/${encodeURIComponent(this.botKey)}${suffix}`;
  }

  async info(): Promise<BotInfo> {
    const res = await fetch(this.url("/info"));
    if (!res.ok) throw new Error(`info failed: ${res.status}`);
    return res.json();
  }

  /** Replies from a person at the business; null when the check failed (try again later). */
  async updates(conversationId: string, after: string | null): Promise<HandoverUpdates | null> {
    try {
      const query = after ? `?after=${encodeURIComponent(after)}` : "";
      const res = await fetch(this.url(`/conversations/${encodeURIComponent(conversationId)}/updates${query}`));
      if (!res.ok) return null;
      const body = await res.json();
      const messages = Array.isArray(body?.messages)
        ? body.messages.filter((m: { text?: unknown; at?: unknown }) => typeof m?.text === "string" && typeof m?.at === "string")
        : [];
      return { human: body?.human === true, messages };
    } catch {
      return null;
    }
  }

  /** Speech to text for the microphone button; null when nothing could be understood. */
  async transcribe(audio: Blob): Promise<string | null> {
    try {
      const res = await fetch(this.url("/transcribe"), {
        method: "POST",
        headers: { "Content-Type": (audio.type || "audio/webm").split(";")[0] },
        body: audio,
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body?.text === "string" && body.text.trim() ? body.text.trim() : null;
    } catch {
      return null;
    }
  }

  /** Saves the visitor's details. Resolves to null on success, or a message to show. */
  async submitLead(lead: LeadInput): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch(this.url("/lead"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
    } catch {
      return "Could not send your details. Check your connection and try again.";
    }
    if (res.ok) return null;
    if (res.status === 429) return "Please wait a moment and try again.";
    if (res.status === 400) {
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") return body.detail;
      } catch {
        /* no JSON body */
      }
      return "Please check your details.";
    }
    return "Sorry, we could not save your details. Please try again.";
  }

  /** Sends a message and streams the answer. Always ends with exactly one onDone or onError. */
  async send(message: string, history: Turn[], handlers: StreamHandlers, context: SendContext = {}, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, ...withoutEmpty(context) }),
        signal,
      });
    } catch {
      handlers.onError("Could not reach the assistant. Check your connection and try again.");
      return;
    }

    if (!res.ok || !res.body) {
      handlers.onError(
        res.status === 429
          ? "You're sending messages too quickly. Please wait a moment."
          : "Sorry, something went wrong. Please try again."
      );
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let finished = false;
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        const text = done ? decoder.decode() + "\n\n" : decoder.decode(value, { stream: true });
        for (const evt of parser.push(text)) {
          const data = safeJson(evt.data);
          if (evt.event === "token" && typeof data.text === "string") handlers.onToken(data.text);
          else if (evt.event === "error") {
            handlers.onError(typeof data.message === "string" ? data.message : "Something went wrong.");
            finished = true;
          } else if (evt.event === "handover") {
            handlers.onHandover?.();
          } else if (evt.event === "sources" && Array.isArray(data.items)) {
            handlers.onSources?.(data.items as SourceRef[]);
          } else if (evt.event === "done") {
            handlers.onDone();
            finished = true;
          }
        }
        if (done) break;
      }
    } catch {
      if (!finished) handlers.onError("The connection was interrupted. Please try again.");
      finished = true;
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (!finished) handlers.onDone();
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function withoutEmpty(o: SendContext): SendContext {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string" && v.length > 0));
}
