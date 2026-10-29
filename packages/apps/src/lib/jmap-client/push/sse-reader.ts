/**
 * Small Server-Sent Events reader over `fetch` (WHATWG HTML "event stream
 * interpretation"). The native `EventSource` cannot send the bearer token, and
 * `@microsoft/fetch-event-source` is unmaintained, so the JMAP push stream
 * reads its response with this instead (docs/architecture/jmap-push.md).
 *
 * It handles `data:`, `id:`, `event:` and `retry:`, comments and CR/LF/CRLF
 * line ends. An event the stream ended in the middle of is dropped.
 */

export type SseEvent = {
  /** `event:` field, `message` when absent. */
  event: string;
  /** The last event id seen on this stream, or null. */
  id: string | null;
  data: string;
};

export type SseHandlers = {
  onEvent: (event: SseEvent) => void;
  /** A valid `retry:` field, in milliseconds. */
  onRetry?: (ms: number) => void;
};

export type SseParser = {
  feed: (chunk: string) => void;
  end: () => void;
};

export function createSseParser(handlers: SseHandlers): SseParser {
  let buffer = "";
  let pendingCr = false;
  let data: string[] = [];
  let eventType = "";
  let lastId: string | null = null;

  const dispatch = () => {
    if (data.length > 0) {
      handlers.onEvent({ event: eventType || "message", id: lastId, data: data.join("\n") });
    }
    data = [];
    eventType = "";
  };

  const line = (text: string) => {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        data.push(value);
        break;
      case "event":
        eventType = value;
        break;
      case "id":
        if (!value.includes("\0")) lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) handlers.onRetry?.(Number(value));
        break;
      default:
        break;
    }
  };

  return {
    feed(chunk) {
      let text = chunk;
      // A CR at the end of the last chunk may pair with an LF at the start of this one.
      if (pendingCr && text.startsWith("\n")) text = text.slice(1);
      pendingCr = false;
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];
        if (char !== "\n" && char !== "\r") continue;
        line(buffer.slice(start, i));
        if (char === "\r") {
          if (i + 1 === buffer.length) pendingCr = true;
          else if (buffer[i + 1] === "\n") i++;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    end() {
      buffer = "";
      data = [];
      eventType = "";
    },
  };
}

/** Reads a whole SSE response body, streaming when the body is readable. */
export async function readSseResponse(response: Response, handlers: SseHandlers): Promise<void> {
  const parser = createSseParser(handlers);
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    parser.feed(await response.text());
    parser.end();
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } finally {
    reader.releaseLock();
    parser.end();
  }
}
