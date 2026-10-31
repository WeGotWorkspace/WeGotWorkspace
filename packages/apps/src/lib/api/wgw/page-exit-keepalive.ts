import { pageIsExiting } from "@/lib/page-exit";

/**
 * Browsers cap the bodies of all in-flight keepalive requests at 64 KiB and reject a request
 * past the cap. Stay below it so a large write is sent as a normal request instead.
 */
const KEEPALIVE_BODY_BUDGET_BYTES = 48 * 1024;

let keepaliveBytesInFlight = 0;

function bodyBytes(body: BodyInit | null | undefined): number | null {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  return null;
}

/**
 * `fetch` that adds `keepalive` once the page is being left, so a write flushed on
 * `beforeunload` / `pagehide` still reaches the server after the page is gone (#1794).
 */
export function fetchKeepaliveOnPageExit(url: string, init: RequestInit): Promise<Response> {
  const bytes = pageIsExiting() ? bodyBytes(init.body) : null;
  if (bytes === null || keepaliveBytesInFlight + bytes > KEEPALIVE_BODY_BUDGET_BYTES) {
    return fetch(url, init);
  }
  keepaliveBytesInFlight += bytes;
  return fetch(url, { ...init, keepalive: true }).finally(() => {
    keepaliveBytesInFlight -= bytes;
  });
}
