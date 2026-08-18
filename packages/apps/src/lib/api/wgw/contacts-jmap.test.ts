import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { wgwFetch, wgwReadJson } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "/api/v1",
  wgwFetch,
  wgwReadJson,
  wgwFetchPrincipal: vi.fn(),
}));

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
});
