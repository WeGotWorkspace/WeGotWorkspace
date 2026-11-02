import { afterEach, describe, expect, it, vi } from "vitest";
import { sendWithUploadProgress } from "@/lib/api/wgw/send-with-upload-progress";

/** Just enough of XMLHttpRequest to drive one request by hand. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  responseType = "";
  status = 0;
  statusText = "";
  response: Blob | null = null;
  responseHeaders = "";
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  getAllResponseHeaders() {
    return this.responseHeaders;
  }
}

function useFakeXhr(): () => FakeXhr {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return () => FakeXhr.last!;
}

describe("sendWithUploadProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXhr.last = null;
  });

  it("reports octets sent, then resolves to a Response with status, headers and body", async () => {
    const xhr = useFakeXhr();
    const sent: number[] = [];
    const body = new Blob(["0123456789"]);
    const pending = sendWithUploadProgress(
      "/jmap/upload/a",
      { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body },
      (bytes) => sent.push(bytes),
    );
    expect(xhr().method).toBe("POST");
    expect(xhr().headers["content-type"]).toBe("application/octet-stream");
    expect(xhr().body).toBe(body);
    xhr().upload.onprogress?.({ loaded: 4 });
    xhr().upload.onprogress?.({ loaded: 10 });
    Object.assign(xhr(), {
      status: 201,
      statusText: "Created",
      response: new Blob(['{"blobId":"b1"}']),
      responseHeaders: "content-type: application/json\r\nx-request-id: 7\r\n",
    });
    xhr().onload?.();

    const response = await pending;
    expect(sent).toEqual([4, 10]);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("7");
    expect(await response.json()).toEqual({ blobId: "b1" });
  });

  it("gives a 204 no body", async () => {
    const xhr = useFakeXhr();
    const pending = sendWithUploadProgress("/x", { method: "PUT" }, () => {});
    Object.assign(xhr(), { status: 204, response: new Blob([]) });
    xhr().onload?.();
    expect((await pending).body).toBeNull();
  });

  it("fails like fetch on a network error", async () => {
    const xhr = useFakeXhr();
    const pending = sendWithUploadProgress("/x", { method: "POST" }, () => {});
    xhr().onerror?.();
    await expect(pending).rejects.toThrow(new TypeError("Failed to fetch"));
  });

  it("aborts with an AbortError when the signal aborts, before or during the request", async () => {
    const xhr = useFakeXhr();
    const controller = new AbortController();
    const pending = sendWithUploadProgress("/x", { signal: controller.signal }, () => {});
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    FakeXhr.last = null;
    await expect(
      sendWithUploadProgress("/x", { signal: controller.signal }, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr()).toBeNull();
  });

  it("falls back to fetch without XMLHttpRequest", async () => {
    vi.stubGlobal("XMLHttpRequest", undefined);
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await sendWithUploadProgress("/x", { method: "POST" }, () => {});
    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith("/x", { method: "POST" });
  });
});
