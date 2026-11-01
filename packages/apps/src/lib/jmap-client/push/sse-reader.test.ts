import { describe, expect, it } from "vitest";
import { createSseParser, readSseResponse, type SseEvent } from "./sse-reader";

function parseAll(chunks: string[]) {
  const events: SseEvent[] = [];
  const retries: number[] = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onRetry: (ms) => retries.push(ms),
  });
  for (const chunk of chunks) parser.feed(chunk);
  parser.end();
  return { events, retries };
}

describe("createSseParser", () => {
  it("reads the server's state event with id, retry and data", () => {
    const { events, retries } = parseAll([
      'event: state\nid: v1;Note=abc\nretry: 3000\ndata: {"@type":"StateChange"}\n\n',
    ]);
    expect(events).toEqual([
      { event: "state", id: "v1;Note=abc", data: '{"@type":"StateChange"}' },
    ]);
    expect(retries).toEqual([3000]);
  });

  it("dispatches nothing for a retry-only response", () => {
    const { events, retries } = parseAll(["retry: 4500\n\n"]);
    expect(events).toEqual([]);
    expect(retries).toEqual([4500]);
  });

  it("joins data lines, strips one leading space and defaults the event to message", () => {
    const { events } = parseAll(["data:a\ndata:  b\n\n"]);
    expect(events).toEqual([{ event: "message", id: null, data: "a\n b" }]);
  });

  it("handles fields split across chunks and CRLF line ends", () => {
    const { events } = parseAll(["eve", "nt: state\r\nda", "ta: x\r", "\n\r\n"]);
    expect(events).toEqual([{ event: "state", id: null, data: "x" }]);
  });

  it("ignores comments, unknown fields and a bad retry", () => {
    const { events, retries } = parseAll([": ping\nfoo: bar\nretry: soon\ndata: y\n\n"]);
    expect(events).toEqual([{ event: "message", id: null, data: "y" }]);
    expect(retries).toEqual([]);
  });

  it("keeps the last id for later events and ignores an id with NUL", () => {
    const { events } = parseAll(["id: one\ndata: a\n\nid: t\0wo\ndata: b\n\n"]);
    expect(events.map((event) => event.id)).toEqual(["one", "one"]);
  });

  it("drops an event the stream ended in the middle of", () => {
    const { events } = parseAll(["data: complete\n\ndata: cut"]);
    expect(events.map((event) => event.data)).toEqual(["complete"]);
  });
});

describe("readSseResponse", () => {
  it("streams the body through the parser", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: state\nid: i1\n"));
        controller.enqueue(encoder.encode("data: {}\n\n"));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    await readSseResponse(new Response(body), { onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ event: "state", id: "i1", data: "{}" }]);
  });

  it("falls back to text() without a readable body", async () => {
    const events: SseEvent[] = [];
    const response = {
      body: null,
      text: async () => "data: z\n\n",
    } as unknown as Response;
    await readSseResponse(response, { onEvent: (event) => events.push(event) });
    expect(events).toEqual([{ event: "message", id: null, data: "z" }]);
  });
});
