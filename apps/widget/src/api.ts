import { SseParser } from "./sse";

export interface BotInfo {
  name: string;
  welcomeMessage: string;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
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

  /** Sends a message and streams the answer. Always ends with exactly one onDone or onError. */
  async send(message: string, history: Turn[], handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.url(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
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
