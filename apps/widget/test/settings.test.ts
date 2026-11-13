import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenNow, mount } from "../src/main";

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 12; i++) await tick();
};

function sse(...events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(encoder.encode(e));
      c.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const info = (extra: object) =>
  new Response(JSON.stringify({ name: "Sunrise Academy", welcomeMessage: "Hi!", ...extra }));

function lastRoot(): ShadowRoot {
  const hosts = document.querySelectorAll("[data-botforge]");
  return hosts[hosts.length - 1].shadowRoot!;
}

afterEach(() => {
  document.querySelectorAll("[data-botforge]").forEach((el) => el.remove());
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("owner settings in the widget", () => {
  it("applies colour, side and logo before the chat is opened", async () => {
    const logo = "data:image/png;base64,iVBORw0KGgo=";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({ appearance: { color: "#0f766e", position: "left", avatar: logo } })));
    mount({ botKey: "bk_look", apiBase: "http://gw/api", accent: "#4f46e5", greeting: null });
    await settle();
    const root = lastRoot();
    expect(root.querySelector(".launcher")!.classList.contains("left")).toBe(true);
    expect(root.querySelector("style")!.textContent).toContain("#0f766e");
    expect(root.querySelector<HTMLImageElement>(".avatar img")!.src).toBe(logo);
  });

  it("ignores unsafe logo and colour values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({ appearance: { color: "red}body{", avatar: "javascript:alert(1)" } })));
    mount({ botKey: "bk_unsafe", apiBase: "http://gw/api", accent: "#4f46e5", greeting: null });
    await settle();
    const root = lastRoot();
    expect(root.querySelector(".avatar img")).toBeNull();
    expect(root.querySelector("style")!.textContent).not.toContain("red}body{");
  });

  it("opens the lead form at the start with the owner's fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({
      leadCapture: { enabled: true, prompt: "Book a site visit?", afterMessages: 2, timing: "start", askEmail: true, askCourse: true, courseLabel: "Property type" },
    })));
    const w = mount({ botKey: "bk_start", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    const root = lastRoot();
    const form = root.querySelector("form.lead")!;
    expect(form).not.toBeNull();
    expect(form.querySelector('input[name="email"]')).not.toBeNull();
    expect(form.textContent).toContain("Property type");
  });

  it("leaves out the interest field when the owner turned it off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({
      leadCapture: { enabled: true, prompt: "Call back?", afterMessages: 1, timing: "start", askCourse: false },
    })));
    const w = mount({ botKey: "bk_nocourse", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    const form = lastRoot().querySelector("form.lead")!;
    expect(form.querySelector('input[name="course"]')).toBeNull();
    expect(form.querySelector('input[name="email"]')).toBeNull();
  });

  it("shows the closed message outside opening hours", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(info({
      hours: { enabled: true, start: "09:00", end: "09:01", days: [], timeZone: "Asia/Kolkata", message: "Closed now, back at 9." },
    })));
    const w = mount({ botKey: "bk_hours", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    const bar = lastRoot().querySelector<HTMLElement>(".hours")!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toBe("Closed now, back at 9.");
  });

  it("shows sources under the answer, linking only to web addresses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(info({}))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"The fee is 68,000."}\n\n',
        'event: sources\ndata: {"items":[{"name":"Fees.pdf","location":"page 2"},{"name":"Site","url":"javascript:alert(1)"},{"name":"Web","location":"Fees","url":"https://x.example/fees"}]}\n\n',
        "event: done\ndata: {}\n\n")));
    const w = mount({ botKey: "bk_src", apiBase: "http://gw/api", accent: "#000", greeting: null });
    w.open();
    await settle();
    w.ask("Fee?");
    await settle();
    const line = lastRoot().querySelector(".sources")!;
    expect(line.textContent).toBe("Sources: Fees.pdf (page 2) · Site · Web (Fees)");
    const links = [...line.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://x.example/fees"]);
  });
});

describe("opening hours", () => {
  // Monday 13 Jan 2025, 10:30 in India = 05:00 UTC
  const monday1030 = new Date("2025-01-13T05:00:00Z");
  const base = { enabled: true, start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5], timeZone: "Asia/Kolkata", message: "" };

  it("uses the business's time zone", () => {
    expect(isOpenNow(base, monday1030)).toBe(true);
    expect(isOpenNow({ ...base, timeZone: "America/New_York" }, monday1030)).toBe(false);   // 00:00 there
  });

  it("respects days and overnight hours", () => {
    expect(isOpenNow({ ...base, days: [2] }, monday1030)).toBe(false);
    expect(isOpenNow({ ...base, start: "20:00", end: "11:00" }, monday1030)).toBe(true);
  });

  it("never claims to be closed for an unknown time zone", () => {
    expect(isOpenNow({ ...base, timeZone: "Mars/Olympus", days: [] }, monday1030)).toBe(true);
  });
});
