import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { wgwFetch, wgwReadJson } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/http")>("@/lib/api/wgw/http");
  return {
    ...actual,
    wgwApiBaseUrl: () => "/api/v1",
    wgwFetch,
    wgwReadJson,
    wgwFetchPrincipal: vi.fn(),
  };
});

import { importVcards, resetContactsJmapClientForTests } from "@/lib/api/wgw/contacts";

describe("contacts JMAP cutover leftovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContactsJmapClientForTests();
  });

  afterEach(() => {
    resetContactsJmapClientForTests();
  });

  it("importVcards still POSTs /contacts/cards/import", async () => {
    wgwFetch.mockResolvedValue({ ok: true, status: 200 });
    wgwReadJson.mockResolvedValue({ created: [], errors: [] });

    await importVcards("BEGIN:VCARD\r\nEND:VCARD", { addressBookId: "default" });

    expect(wgwFetch).toHaveBeenCalledWith(
      "/contacts/cards/import?addressBookId=default",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "text/vcard" },
      }),
    );
    const paths = wgwFetch.mock.calls.map((call) => String(call[0]));
    expect(paths.every((path) => path.startsWith("/contacts/cards/import"))).toBe(true);
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
});
