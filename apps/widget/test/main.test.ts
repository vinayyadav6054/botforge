import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationId, initials, mount, readOptions } from "../src/main";
import { hex6 } from "../src/styles";

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
    expect(readOptions(s)).toEqual({
      botKey: "bk_1", apiBase: "https://gw.example.com/api", accent: "#0f766e",
      greeting: "Hi! Have a question? Ask me here, I reply instantly.",
    });
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
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
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
    expect(JSON.parse(sessionStorage.getItem("kahiye:bk_t:history")!)).toEqual([
      { role: "user", text: "Open on Sunday?" },
      { role: "assistant", text: "Closed on Sundays." },
    ]);
  });

  it("ask() before the chat was opened keeps the welcome message first", async () => {
    let releaseInfo!: () => void;
    const info = new Promise<Response>((r) => {
      releaseInfo = () => r(new Response(JSON.stringify({ name: "Demo Bot", welcomeMessage: "Welcome!" })));
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(info)
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"Rs 500."}\n\n', "event: done\ndata: {}\n\n")));

    const widget = mount({ botKey: "bk_order", apiBase: "http://gw/api", accent: "#000" });
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    widget.ask("Fees?");
    await tick();
    releaseInfo();   // the bot's settings arrive after the question was asked
    for (let i = 0; i < 10; i++) await tick();

    expect([...root.querySelectorAll(".msg")].map((m) => m.textContent)).toEqual(["Welcome!", "Fees?", "Rs 500."]);
  });

  it("shows the business's booking and payment buttons, and only safe links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      name: "Academy", welcomeMessage: "Hi!",
      actions: [
        { kind: "booking", label: "Book a <b>demo</b>", url: "https://calendly.com/a" },
        { kind: "payment", label: "Bad", url: "javascript:alert(1)" },
        { kind: "upi", label: "Pay fees", url: "upi://pay?pa=a%40ybl&pn=A&cu=INR", upiId: "a@ybl" },
      ],
    }))));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    const widget = mount({ botKey: "bk_actions", apiBase: "http://gw/api", accent: "#000" });
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    widget.open();
    for (let i = 0; i < 5; i++) await tick();

    const links = [...root.querySelectorAll<HTMLAnchorElement>(".actions a")];
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Book a <b>demo</b>", "https://calendly.com/a"],
      ["Pay fees", "upi://pay?pa=a%40ybl&pn=A&cu=INR"],
    ]);
    expect(links[0].target).toBe("_blank");
    expect(links[0].rel).toBe("noopener noreferrer");
    expect(root.querySelector(".actions")!.hasAttribute("hidden")).toBe(false);

    // on a computer the UPI button copies the ID instead of opening a phone-only link
    links[1].click();
    expect(writeText).toHaveBeenCalledWith("a@ybl");
    expect([...root.querySelectorAll(".msg.bot")].pop()!.textContent).toContain("a@ybl");
  });

  it("hands over to a person: no bot bubble, then their replies appear", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith("/info")) return new Response(JSON.stringify({ name: "Academy", welcomeMessage: "Hi!" }));
        if (url.includes("/updates")) {
          return new Response(JSON.stringify({ human: true, messages: [{ text: "Priya here, how can I help?", at: "2026-11-14T10:00:00Z" }] }));
        }
        return sse("event: meta\ndata: {}\n\n", "event: handover\ndata: {}\n\n", "event: done\ndata: {}\n\n");
      });
      vi.stubGlobal("fetch", fetchMock);

      const widget = mount({ botKey: "bk_handover", apiBase: "http://gw/api", accent: "#000" });
      const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
      widget.open();
      for (let i = 0; i < 5; i++) await tick();
      widget.ask("Can I talk to someone?");
      for (let i = 0; i < 10; i++) await tick();

      const texts = () => [...root.querySelectorAll(".msg")].map((m) => m.textContent);
      expect(texts()).toEqual(["Hi!", "Can I talk to someone?", "You are now chatting with a person from Academy."]);
      expect(root.querySelector(".status")!.textContent).toBe("Chatting with a person");

      await vi.advanceTimersByTimeAsync(3100);
      for (let i = 0; i < 5; i++) await tick();
      expect(texts().at(-1)).toBe("Priya here, how can I help?");
      expect(root.querySelector(".msg.agent")).not.toBeNull();
      const poll = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/updates"))!;
      expect(poll).toMatch(/\/chat\/bk_handover\/conversations\/[0-9a-f-]{36}\/updates\?after=/);
      // the next check only asks for newer replies
      expect(sessionStorage.getItem("kahiye:bk_handover:agentSince")).toBe("2026-11-14T10:00:00Z");
      expect(JSON.parse(sessionStorage.getItem("kahiye:bk_handover:history")!).at(-1))
        .toEqual({ role: "assistant", text: "Priya here, how can I help?" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not check for replies before the visitor has written anything", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "A", welcomeMessage: "Hi" })));
      vi.stubGlobal("fetch", fetchMock);
      mount({ botKey: "bk_quiet", apiBase: "http://gw/api", accent: "#000" }).open();
      await vi.advanceTimersByTimeAsync(20000);
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/updates"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the action bar when the business has no buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ name: "A", welcomeMessage: "Hi" }))));
    const widget = mount({ botKey: "bk_noactions", apiBase: "http://gw/api", accent: "#000" });
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    widget.open();
    for (let i = 0; i < 5; i++) await tick();
    expect(root.querySelector(".actions")!.hasAttribute("hidden")).toBe(true);
  });

  it("renders bot text as text, never as HTML", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "<b>x</b>", welcomeMessage: "<img src=x onerror=alert(1)>" }))));
    const widget = mount({ botKey: "bk_x", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await tick();
    await tick();
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".msg.bot")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("shows an error when the bot cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })));
    const widget = mount({ botKey: "bk_missing", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await tick();
    await tick();
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    expect(root.querySelector(".msg.error")!.textContent).toMatch(/not available/);
  });
});

describe("lead capture", () => {
  const settle = async () => {
    for (let i = 0; i < 12; i++) await tick();
  };
  const info = (leadCapture?: object) =>
    new Response(JSON.stringify({ name: "Kalra Classes", welcomeMessage: "Hi!", leadCapture }));
  const answer = () => sse('event: token\ndata: {"text":"Fees are 1 lakh."}\n\n', "event: done\ndata: {}\n\n");

  async function chatOnce(fetchMock: ReturnType<typeof vi.fn>, afterMessages = 1) {
    fetchMock
      .mockResolvedValueOnce(info({ enabled: true, prompt: "Want a call back?", afterMessages }))
      .mockResolvedValueOnce(answer());
    vi.stubGlobal("fetch", fetchMock);
    const widget = mount({ botKey: "bk_lead", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await settle();
    widget.ask("What are the fees?");
    await settle();
    return document.querySelector("[data-kahiye]")!.shadowRoot!;
  }

  function fill(root: ShadowRoot, values: Record<string, string>) {
    for (const [k, v] of Object.entries(values))
      (root.querySelector(`form.lead input[name="${k}"]`) as HTMLInputElement).value = v;
    root.querySelector("form.lead")!.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  it("ask() sends a question like a typed message", async () => {
    const root = await chatOnce(vi.fn(), 0);
    const bubbles = [...root.querySelectorAll(".msg")].map((m) => m.textContent);
    expect(bubbles).toEqual(["Hi!", "What are the fees?", "Fees are 1 lakh."]);
  });

  it("offers the form after the configured number of answers and submits it", async () => {
    const fetchMock = vi.fn();
    const root = await chatOnce(fetchMock);
    const card = root.querySelector("form.lead")!;
    expect(card.querySelector(".lead-intro")!.textContent).toBe("Want a call back?");
    expect(card.querySelector(".lead-consent")!.textContent).toContain("Kalra Classes may contact you");
    expect((root.querySelector(".talk") as HTMLButtonElement).hidden).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    fill(root, { name: "Asha", phone: "98200 12345", course: "JEE" });
    await settle();

    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe("http://gw/api/chat/bk_lead/lead");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ name: "Asha", phone: "98200 12345", course: "JEE" });
    expect(body.transcript).toEqual([
      { role: "user", text: "What are the fees?" },
      { role: "assistant", text: "Fees are 1 lakh." },
    ]);
    expect(body.website).toBeUndefined();
    expect(root.querySelector("form.lead")).toBeNull();
    expect([...root.querySelectorAll(".msg.bot")].pop()!.textContent).toBe("Thank you, Asha! Our team will contact you soon.");
    expect((root.querySelector(".talk") as HTMLButtonElement).hidden).toBe(true);
    expect(sessionStorage.getItem("kahiye:bk_lead:lead")).toBe("done");
  });

  it("validates locally and shows server errors without losing the input", async () => {
    const fetchMock = vi.fn();
    const root = await chatOnce(fetchMock);
    fill(root, { name: "", phone: "98200 12345" });
    await settle();
    expect(root.querySelector(".lead-error")!.textContent).toBe("Please enter your name.");
    expect(fetchMock).toHaveBeenCalledTimes(2); // nothing sent

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Please enter a valid phone number." }), { status: 400 }));
    fill(root, { name: "Asha", phone: "5555555555" });
    await settle();
    expect(root.querySelector(".lead-error")!.textContent).toBe("Please enter a valid phone number.");
    expect((root.querySelector('form.lead input[name="name"]') as HTMLInputElement).value).toBe("Asha");
  });

  it("'No thanks' hides the form and it is not offered again", async () => {
    const root = await chatOnce(vi.fn());
    (root.querySelector(".lead-skip") as HTMLButtonElement).click();
    expect(root.querySelector("form.lead")).toBeNull();
    expect(sessionStorage.getItem("kahiye:bk_lead:lead")).toBe("dismissed");
    // the header button still works
    (root.querySelector(".talk") as HTMLButtonElement).click();
    expect(root.querySelector("form.lead")).not.toBeNull();
  });

  it("opens the form when the assistant could not answer, even with afterMessages 0", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(info({ enabled: true, prompt: "Want a call back?", afterMessages: 0 }))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"Iski jaankari abhi mere paas nahi hai."}\n\n',
        "event: offer_lead\ndata: {}\n\n", "event: done\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const widget = mount({ botKey: "bk_unknown", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await settle();
    widget.ask("hostel ki fees?");
    await settle();
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    expect([...root.querySelectorAll(".msg.bot")].pop()!.textContent).toBe("Iski jaankari abhi mere paas nahi hai.");
    expect(root.querySelector("form.lead")).not.toBeNull();
  });

  it("does not push the form again after the visitor said 'No thanks'", async () => {
    sessionStorage.setItem("kahiye:bk_nothanks:lead", "dismissed");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(info({ enabled: true, prompt: "Call?", afterMessages: 1 }))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"I don\'t have that information yet."}\n\n',
        "event: offer_lead\ndata: {}\n\n", "event: done\ndata: {}\n\n")));
    const widget = mount({ botKey: "bk_nothanks", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await settle();
    widget.ask("hostel?");
    await settle();
    expect(document.querySelector("[data-kahiye]")!.shadowRoot!.querySelector("form.lead")).toBeNull();
  });

  it("afterMessages 0 never pops up on its own", async () => {
    const root = await chatOnce(vi.fn(), 0);
    expect(root.querySelector("form.lead")).toBeNull();
    expect((root.querySelector(".talk") as HTMLButtonElement).hidden).toBe(false);
  });

  it("does nothing when lead capture is off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce(answer()));
    const widget = mount({ botKey: "bk_off", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await settle();
    widget.ask("hi");
    await settle();
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    expect((root.querySelector(".talk") as HTMLButtonElement).hidden).toBe(true);
    expect(root.querySelector("form.lead")).toBeNull();
  });

  it("renders the prompt as text, never as HTML", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(info({ enabled: true, prompt: "<img src=x onerror=alert(1)>", afterMessages: 1 }))
      .mockResolvedValueOnce(answer());
    vi.stubGlobal("fetch", fetchMock);
    const widget = mount({ botKey: "bk_xss", apiBase: "http://gw/api", accent: "#000" });
    widget.open();
    await settle();
    widget.ask("q");
    await settle();
    const root = document.querySelector("[data-kahiye]")!.shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".lead-intro")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("redesign", () => {
  const settle = async () => {
    for (let i = 0; i < 12; i++) await tick();
  };
  const shadow = () => document.querySelector("[data-kahiye]")!.shadowRoot!;

  it("derives initials and expands short colours", () => {
    expect(initials("Kalrashukla Classes")).toBe("KC");
    expect(initials("bakery")).toBe("B");
    expect(initials("  SP   Classes for JEE ")).toBe("SC");
    expect(initials("🍰 !!")).toBe("");
    expect(hex6("#abc")).toBe("#aabbcc");
    expect(hex6("#0f766ecc")).toBe("#0f766e");
  });

  it("reads a custom greeting, or turns it off", () => {
    const s = document.createElement("script");
    s.dataset.botKey = "bk_1";
    s.dataset.greeting = "Ask about admissions!";
    expect(readOptions(s)?.greeting).toBe("Ask about admissions!");
    s.dataset.greeting = "off";
    expect(readOptions(s)?.greeting).toBeNull();
  });

  it("shows initials and suggested questions; a chip sends its question and the chips go away", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "Kalra Classes", welcomeMessage: "Hi!", suggestedQuestions: ["Fees?", "", 5, "Batches?"],
      })))
      .mockResolvedValueOnce(sse('event: token\ndata: {"text":"1 lakh."}\n\n', "event: done\ndata: {}\n\n")));
    mount({ botKey: "bk_chips", apiBase: "http://gw/api", accent: "#000" }).open();
    await settle();
    const root = shadow();
    expect(root.querySelector(".avatar")!.textContent).toBe("KC");
    expect(root.querySelector(".row.bot .mini")!.textContent).toBe("KC");
    const chips = [...root.querySelectorAll<HTMLButtonElement>(".chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["Fees?", "Batches?"]);

    chips[0].click();
    await settle();
    expect(root.querySelector(".chips")).toBeNull();
    expect([...root.querySelectorAll(".msg")].map((m) => m.textContent)).toEqual(["Hi!", "Fees?", "1 lakh."]);
  });

  it("does not show chips when the conversation already has history", async () => {
    sessionStorage.setItem("kahiye:bk_hist:history", JSON.stringify([{ role: "user", text: "Hello" }]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      name: "Bot", welcomeMessage: "Hi!", suggestedQuestions: ["Fees?"],
    }))));
    mount({ botKey: "bk_hist", apiBase: "http://gw/api", accent: "#000" }).open();
    await settle();
    expect(shadow().querySelector(".chips")).toBeNull();
  });

  it("shows the greeting once per visit after a delay, and opening the chat hides it", () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "Bot", welcomeMessage: "Hi!" }))));
      const widget = mount({ botKey: "bk_greet", apiBase: "http://gw/api", accent: "#000", greeting: "Need help?" });
      const root = shadow();
      const greeting = root.querySelector<HTMLElement>(".greeting")!;
      expect(greeting.hidden).toBe(true);
      vi.advanceTimersByTime(4000);
      expect(greeting.hidden).toBe(false);
      expect(greeting.textContent).toContain("Need help?");
      expect(root.querySelector<HTMLElement>(".badge")!.hidden).toBe(false);

      widget.open();
      expect(greeting.hidden).toBe(true);
      expect(root.querySelector<HTMLElement>(".badge")!.hidden).toBe(true);

      // same visit, new page: not shown again
      document.body.innerHTML = "";
      mount({ botKey: "bk_greet", apiBase: "http://gw/api", accent: "#000", greeting: "Need help?" });
      vi.advanceTimersByTime(5000);
      expect(shadow().querySelector<HTMLElement>(".greeting")!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows a greeting when it is turned off", () => {
    vi.useFakeTimers();
    try {
      mount({ botKey: "bk_off", apiBase: "http://gw/api", accent: "#000", greeting: null });
      vi.advanceTimersByTime(10000);
      expect(shadow().querySelector<HTMLElement>(".greeting")!.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the thank-you message as a success", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "K", welcomeMessage: "Hi!", leadCapture: { enabled: true, prompt: "Call?", afterMessages: 0 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }))));
    mount({ botKey: "bk_ok", apiBase: "http://gw/api", accent: "#000" }).open();
    await settle();
    const root = shadow();
    root.querySelector<HTMLButtonElement>(".talk")!.click();
    (root.querySelector('form.lead input[name="name"]') as HTMLInputElement).value = "Asha";
    (root.querySelector('form.lead input[name="phone"]') as HTMLInputElement).value = "9820012345";
    root.querySelector("form.lead")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(root.querySelector(".msg.bot.success")!.textContent).toBe("Thank you, Asha! Our team will contact you soon.");
  });
});

describe("plans and conversation history", () => {
  const infoWith = (extra: object) =>
    new Response(JSON.stringify({ name: "Bot", welcomeMessage: "Hi!", ...extra }), { status: 200 });

  it("shows the badge unless the plan removes it, and only links to http(s)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(infoWith({ branding: { show: true, url: "javascript:alert(1)" } })));
    const w = mount({ botKey: "bk_badge1", apiBase: "http://gw/api", accent: "#0f766e", greeting: null });
    w.open();
    const root = document.querySelectorAll("[data-kahiye]")[document.querySelectorAll("[data-kahiye]").length - 1].shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>(".footer")!.hidden).toBe(false));
    expect(root.querySelector(".footer a")).toBeNull();
    expect(root.querySelector(".footer")!.textContent).toContain("Powered by Kahiye");
  });

  it("hides the badge on plans without it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(infoWith({ branding: { show: false } })));
    const w = mount({ botKey: "bk_badge2", apiBase: "http://gw/api", accent: "#0f766e", greeting: null });
    w.open();
    const root = document.querySelectorAll("[data-kahiye]")[document.querySelectorAll("[data-kahiye]").length - 1].shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector(".title")!.textContent).toBe("Bot"));
    expect(root.querySelector<HTMLElement>(".footer")!.hidden).toBe(true);
  });

  it("keeps one conversation id per session and bot", () => {
    sessionStorage.clear();
    const a = conversationId("kahiye:bk_1:conversation");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(conversationId("kahiye:bk_1:conversation")).toBe(a);
    expect(conversationId("kahiye:bk_2:conversation")).not.toBe(a);
  });
});
