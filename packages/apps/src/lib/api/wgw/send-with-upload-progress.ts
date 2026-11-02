import { fetchKeepaliveOnPageExit } from "@/lib/api/wgw/page-exit-keepalive";

/** `RequestInit` for `wgwFetch`, plus the octets of the body sent so far. */
export type WgwRequestInit = RequestInit & { onUploadProgress?: (sentBytes: number) => void };

/** With `onUploadProgress`, sends so it can report it; otherwise as before. */
export function sendWgwRequest(url: string, init: WgwRequestInit): Promise<Response> {
  const { onUploadProgress, ...rest } = init;
  return onUploadProgress
    ? sendWithUploadProgress(url, rest, onUploadProgress)
    : fetchKeepaliveOnPageExit(url, rest);
}

/**
 * `fetch` cannot report how much of a request body is sent, so a file sent in
 * one request showed no progress until it was done. This sends the request with
 * `XMLHttpRequest` and calls `onSent` with the octets sent so far, then resolves
 * to an ordinary `Response`. Without `XMLHttpRequest` (tests, workers) it falls
 * back to `fetch`. Failures match `fetch`: a `TypeError("Failed to fetch")` for
 * the network, an `AbortError` when `init.signal` aborts.
 */
export function sendWithUploadProgress(
  url: string,
  init: RequestInit,
  onSent: (sentBytes: number) => void,
): Promise<Response> {
  if (typeof XMLHttpRequest === "undefined") return fetch(url, init);
  const signal = init.signal ?? undefined;
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open(init.method ?? "GET", url);
    new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.responseType = "blob";
    xhr.upload.onprogress = (event) => onSent(event.loaded);
    xhr.onload = () => {
      done();
      resolve(responseOf(xhr));
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError("Failed to fetch"));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function responseOf(xhr: XMLHttpRequest): Response {
  const headers = new Headers();
  for (const line of xhr
    .getAllResponseHeaders()
    .trim()
    .split(/[\r\n]+/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const body = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as Blob | null);
  return new Response(body, { status: xhr.status, statusText: xhr.statusText, headers });
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
