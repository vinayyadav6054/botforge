import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatApi } from "../src/api";

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function collect() {
  const tokens: string[] = [];
  const errors: string[] = [];
  let done = 0;
  return {
    tokens,
    errors,
    get done() {
      return done;
    },
    handlers: {
      onToken: (t: string) => tokens.push(t),
      onError: (m: string) => errors.push(m),
      onDone: () => done++,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("ChatApi", () => {
  it("builds the right URLs and sends history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["event: done\ndata: {}\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const api = new ChatApi("http://gw/api/", "bk_abc");
    const c = collect();
    await api.send("hello", [{ role: "user", text: "earlier" }], c.handlers);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gw/api/chat/bk_abc");
    expect(JSON.parse(init.body)).toEqual({ message: "hello", history: [{ role: "user", text: "earlier" }] });
  });

  it("streams tokens then done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      'event: meta\ndata: {"sources":1}\n\n',
      'event: token\ndata: {"text":"Open "}\n\nevent: tok',
      'en\ndata: {"text":"9-5"}\n\n',
      "event: done\ndata: {}\n\n",
    ])));
    const c = collect();
    await new ChatApi("http://gw/api", "bk_x").send("q", [], c.handlers);
    expect(c.tokens.join("")).toBe("Open 9-5");
    expect(c.done).toBe(1);
    expect(c.errors).toEqual([]);
  });

  it("reports server error events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      'event: error\ndata: {"message":"busy"}\n\n',
    ])));
    const c = collect();
    await new ChatApi("http://gw/api", "bk_x").send("q", [], c.handlers);
    expect(c.errors).toEqual(["busy"]);
    expect(c.done).toBe(0);
  });

  it("explains rate limiting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    const c = collect();
    await new ChatApi("http://gw/api", "bk_x").send("q", [], c.handlers);
    expect(c.errors[0]).toMatch(/too quickly/);
  });

  it("handles network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const c = collect();
    await new ChatApi("http://gw/api", "bk_x").send("q", [], c.handlers);
    expect(c.errors[0]).toMatch(/Could not reach/);
  });

  it("finishes when the stream ends without a done event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(['event: token\ndata: {"text":"x"}\n\n'])));
    const c = collect();
    await new ChatApi("http://gw/api", "bk_x").send("q", [], c.handlers);
    expect(c.tokens).toEqual(["x"]);
    expect(c.done).toBe(1);
  });
});
