import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { writeContactsBootstrapToCache } from "@/lib/offline/contacts-offline-store";
import { createHybridContactsApiSource } from "./contacts-api-source";

const username = "carol";

vi.mock("@/lib/offline/core/offline-session", () => ({
  rememberOfflineContactsUsername: vi.fn(),
  readOfflineContactsUsername: vi.fn(() => username),
  resolveContactsOfflineUsername: (sessionUsername?: string) => sessionUsername?.trim() || username,
}));

describe("createHybridContactsApiSource", () => {
  beforeEach(async () => {
    const bootstrap = createContactsAppBootstrap({
      session: {
        user: {
          displayName: "Carol",
          initials: "C",
          username,
          email: "carol@example.com",
        },
        viewerInboxLabel: "me",
      },
    });
    await writeContactsBootstrapToCache(username, bootstrap);
  });

  it("creates hybrid operations from cached username when session username is missing", () => {
    const source = createHybridContactsApiSource();
    const bootstrap = createContactsAppBootstrap();

    const operations = source.createOperations(bootstrap);

    expect(operations?.patchCard).toBeTypeOf("function");
  });
});
