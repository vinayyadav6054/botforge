import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatApi } from "../src/api";
import { pickLanguage, speechLang, TEXTS } from "../src/i18n";
import { mount } from "../src/main";

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};
const info = (extra: object) => new Response(JSON.stringify({ name: "Sunrise", welcomeMessage: "Hi!", ...extra }));
function sse(...events: string[]): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(enc.encode(e))); c.close(); } }));
}
const root = () => {
  const hosts = document.querySelectorAll("[data-botforge]");
  return hosts[hosts.length - 1].shadowRoot!;
};

afterEach(() => {
  document.querySelectorAll("[data-botforge]").forEach((el) => el.remove());
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("languages", () => {
  it("picks the owner's language, else the browser's, else English", () => {
    expect(pickLanguage("hi", "en-US")).toBe("hi");
    expect(pickLanguage("bn", "hi-IN")).toBe("en");      // no widget texts for Bengali yet: English buttons
    expect(pickLanguage("auto", "mr-IN")).toBe("mr");
    expect(pickLanguage("auto", "fr-FR")).toBe("en");
    expect(pickLanguage(undefined, undefined)).toBe("en");
  });

  it("every language has every text", () => {
    const keys = Object.keys(TEXTS.en).sort();
    for (const [lang, t] of Object.entries(TEXTS)) {
      expect(Object.keys(t).sort(), lang).toEqual(keys);
      expect(t.consent, lang).toContain("{name}");
      expect(t.thanks, lang).toContain("{name}");
    }
  });

  it("shows Hindi texts for a Hindi bot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({ language: "hi" })));
    const w = mount({ botKey: "bk_hi", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    expect(root().querySelector("textarea")!.placeholder).toBe(TEXTS.hi.placeholder);
    expect(root().querySelector(".status")!.textContent).toBe(TEXTS.hi.online);
  });

  it("chooses a voice from the answer's script", () => {
    expect(speechLang("फीस 68,000 है", "hi")).toBe("hi-IN");
    expect(speechLang("फी 68,000 आहे", "mr")).toBe("mr-IN");
    expect(speechLang("கட்டணம்", "en")).toBe("ta-IN");
    expect(speechLang("The fee is 68,000", "hi")).toBe("en-IN");
  });
});

describe("voice", () => {
  it("hides the microphone where the browser cannot record, or when the owner turned voice off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({ voice: false })));
    const w = mount({ botKey: "bk_novoice", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    expect(root().querySelector<HTMLButtonElement>(".mic")!.hidden).toBe(true);
    expect(root().querySelector<HTMLButtonElement>(".speak")!.hidden).toBe(true);
  });

  it("reads answers aloud when the visitor turns it on", async () => {
    const spoken: { text: string; lang: string }[] = [];
    class Utterance { lang = ""; constructor(public text: string) {} }
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak: (u: Utterance) => spoken.push({ text: u.text, lang: u.lang }) });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(info({}))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"फीस 68,000 है।"}\n\n', "event: done\ndata: {}\n\n")));
    const w = mount({ botKey: "bk_speak", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    const speakBtn = root().querySelector<HTMLButtonElement>(".speak")!;
    expect(speakBtn.hidden).toBe(false);
    speakBtn.click();
    expect(speakBtn.getAttribute("aria-pressed")).toBe("true");
    w.ask("Fees?");
    await settle();
    expect(spoken).toEqual([{ text: "फीस 68,000 है।", lang: "hi-IN" }]);
  });

  it("sends recordings for transcription", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "fees kitni hai?" })));
    vi.stubGlobal("fetch", fetchMock);
    const text = await new ChatApi("http://gw/api", "bk_x").transcribe(new Blob(["x"], { type: "audio/webm;codecs=opus" }));
    expect(text).toBe("fees kitni hai?");
    expect(fetchMock.mock.calls[0][0]).toBe("http://gw/api/chat/bk_x/transcribe");
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("audio/webm");

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    expect(await new ChatApi("http://gw/api", "bk_x").transcribe(new Blob(["x"]))).toBeNull();
  });
});
