import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, readOptions } from "../src/main";

const tick = () => new Promise((r) => setTimeout(r, 0));

function sse(...events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(encoder.encode(e));
        c.close();
      },
    }),
    { status: 200 }
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("readOptions", () => {
  it("requires a bot key", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = document.createElement("script");
    expect(readOptions(s)).toBeNull();
  });

  it("derives the API base from the script origin and validates the color", () => {
    const s = document.createElement("script");
    s.src = "https://gw.example.com/widget.js";
    s.dataset.botKey = "bk_1";
    s.dataset.color = "red;}body{display:none";
    expect(readOptions(s)).toEqual({ botKey: "bk_1", apiBase: "https://gw.example.com/api", accent: "#4f46e5" });
    s.dataset.color = "#ff0000";
    s.dataset.api = "https://other/api";
    expect(readOptions(s)?.accent).toBe("#ff0000");
    expect(readOptions(s)?.apiBase).toBe("https://other/api");
  });
});

describe("mount", () => {
  it("shows the welcome message, streams an answer and keeps history", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Bakery Bot", welcomeMessage: "Hello there!" })))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"Closed on Sundays."}\n\n', "event: done\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetchMock);

    const widget = mount({ botKey: "bk_t", apiBase: "http://gw/api", accent: "#000" });
    const root = document.querySelector("[data-botforge]")!.shadowRoot!;
    widget.open();
    await tick();
    await tick();

    expect(root.querySelector(".title")!.textContent).toBe("Bakery Bot");
    expect(root.querySelector(".msg.bot")!.textContent).toBe("Hello there!");

    const input = root.querySelector("textarea")!;
    input.value = "Open on Sunday?";
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    for (let i = 0; i < 10; i++) await tick();

    const bubbles = [...root.querySelectorAll(".msg")].map((m) => m.textContent);
    expect(bubbles).toEqual(["Hello there!", "Open on Sunday?", "Closed on Sundays."]);
    expect(JSON.parse(sessionStorage.getItem("botforge:bk_t:history")!)).toEqual([
      { role: "user", text: "Open on Sunday?" },
      { role: "assistant", text: "Closed on Sundays." },
    ]);
  });

  it("renders bot text as text, never as HTML", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "<b>x</b>", welcomeMessage: "<img src=x onerror=alert(1)>" }))));
    const widget = mount({ botKey: "bk_x", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await tick();
    await tick();
    const root = document.querySelector("[data-botforge]")!.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".msg.bot")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("shows an error when the bot cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })));
    const widget = mount({ botKey: "bk_missing", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await tick();
    await tick();
    const root = document.querySelector("[data-botforge]")!.shadowRoot!;
    expect(root.querySelector(".msg.error")!.textContent).toMatch(/not available/);
  });
});
