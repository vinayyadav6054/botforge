import { describe, expect, it } from "vitest";
import { SseParser } from "../src/sse";

describe("SseParser", () => {
  it("parses complete events", () => {
    const p = new SseParser();
    const events = p.push('event: token\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n');
    expect(events).toEqual([
      { event: "token", data: '{"text":"Hi"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("buffers events split across chunks", () => {
    const p = new SseParser();
    expect(p.push("event: tok")).toEqual([]);
    expect(p.push('en\ndata: {"te')).toEqual([]);
    expect(p.push('xt":"a"}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: "token", data: '{"text":"a"}' }]);
  });

  it("handles CRLF line endings", () => {
    const p = new SseParser();
    expect(p.push("event: done\r\ndata: {}\r\n\r\n")).toEqual([{ event: "done", data: "{}" }]);
  });

  it("joins multi-line data and defaults the event name", () => {
    const p = new SseParser();
    expect(p.push("data: line1\ndata: line2\n\n")).toEqual([{ event: "message", data: "line1\nline2" }]);
  });

  it("ignores comments and blocks without data", () => {
    const p = new SseParser();
    expect(p.push(": keep-alive\n\nevent: ping\n\n")).toEqual([]);
  });
});
