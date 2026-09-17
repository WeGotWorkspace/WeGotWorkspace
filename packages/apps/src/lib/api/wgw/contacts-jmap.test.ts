import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { wgwFetch } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return {
    ...actual,
    wgwApiBaseUrl: () => "/api/v1",
    wgwFetch,
    wgwFetchPrincipal: vi.fn(),
  };
});

import { importVcards, resetContactsJmapClientForTests } from "@/lib/api/wgw/contacts";

function jsonResponse(
  status: number,
  body: unknown,
  extra: { statusText?: string; url?: string } = {},
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: extra.statusText ?? "",
    url: extra.url ?? "http://localhost:5174/api/v1/contacts/cards/import",
    text: async () => text,
  } as Response;
}

describe("contacts JMAP cutover leftovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContactsJmapClientForTests();
  });

  afterEach(() => {
    resetContactsJmapClientForTests();
  });

  it("importVcards still POSTs /contacts/cards/import", async () => {
    wgwFetch.mockResolvedValue(jsonResponse(201, { list: [], errors: [] }));

    await importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" });

    expect(wgwFetch).toHaveBeenCalledWith(
      "/contacts/cards/import?addressBookId=default",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "text/vcard", Accept: "application/json" },
      }),
    );
    const init = wgwFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(Blob);
    expect((init.body as Blob).type).toBe("text/vcard");
    await expect((init.body as Blob).text()).resolves.toBe("BEGIN:VCARD\r\nEND:VCARD");
    const paths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(paths.every((path) => path.startsWith("/contacts/cards/import"))).toBe(true);
  });

  it("sends overlapping importVcards POSTs one after another", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let fetches = 0;
    wgwFetch.mockImplementation(async () => {
      fetches += 1;
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      if (fetches === 1) await firstGate;
      inflight -= 1;
      return jsonResponse(201, { list: [], errors: [] });
    });

    const first = importVcards("BEGIN:VCARD\r\nFN:One\r\nEND:VCARD", { addressBookId: "default" });
    const second = importVcards("BEGIN:VCARD\r\nFN:Two\r\nEND:VCARD", { addressBookId: "default" });
    await vi.waitFor(() => expect(fetches).toBe(1));
    expect(maxInflight).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(fetches).toBe(2);
    expect(maxInflight).toBe(1);
  });

  it("surfaces Failed to fetch when the POST never reaches PHP", async () => {
    wgwFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).rejects.toMatchObject({ message: "Failed to fetch" });
  });

  it("importVcards surfaces JSON error and code from a failed POST", async () => {
    wgwFetch.mockResolvedValue({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      text: async () =>
        JSON.stringify({
          error: "Upload too large. Current server post_max_size is 8M.",
          code: "post_too_large",
        }),
    });

    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "Upload too large. Current server post_max_size is 8M.",
        status: 413,
      }),
    );
  });

  it("importVcards falls back to HTTP status when the server sent nothing useful", async () => {
    wgwFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "",
      text: async () => "",
    });

    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).rejects.toMatchObject({ message: "HTTP 403", status: 403 });
  });

  it("importVcards treats 200 empty or non-JSON text as success", async () => {
    wgwFetch.mockResolvedValueOnce(jsonResponse(200, ""));
    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).resolves.toEqual({ list: [], errors: [] });

    wgwFetch.mockResolvedValueOnce(jsonResponse(200, "BEGIN:VCARD\nEND:VCARD"));
    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).resolves.toEqual({ list: [], errors: [] });
  });

  it("importVcards reads 201 JSON and does not throw Expected JSON", async () => {
    wgwFetch.mockResolvedValue(jsonResponse(201, { list: [{ id: "card-1" }], errors: [] }));
    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).resolves.toEqual({ list: [{ id: "card-1" }], errors: [] });
  });

  it("importVcards surfaces post_too_large when PHP prepended an HTML warning on 200", async () => {
    const body =
      "<br />\n<b>Warning</b>:  PHP Request Startup: POST Content-Length of 9437184 bytes exceeds the limit of 8388608 bytes in <b>Unknown</b> on line <b>0</b><br />\n" +
      JSON.stringify({
        error: "Upload too large. Current server post_max_size is 8M.",
        code: "post_too_large",
      });
    wgwFetch.mockResolvedValue(jsonResponse(200, body, { statusText: "OK" }));

    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).rejects.toMatchObject({
      message: "Upload too large. Current server post_max_size is 8M.",
      status: 413,
    });
  });

  it("importVcards uses a short HTML reason instead of the raw URL", async () => {
    wgwFetch.mockResolvedValue(
      jsonResponse(200, "<!DOCTYPE html><html><body>Vite</body></html>", {
        url: "http://localhost:5174/api/v1/contacts/cards/import?addressBookId=group-administrators",
      }),
    );

    await expect(
      importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" }),
    ).rejects.toMatchObject({
      message: "Server returned HTML instead of a result",
    });
  });
});
