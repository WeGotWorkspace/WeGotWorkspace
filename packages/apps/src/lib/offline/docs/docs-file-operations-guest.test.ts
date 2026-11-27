import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { createDocsFileOperations } from "@/lib/offline/docs/docs-file-operations";
import "@/lib/offline/drive/drive-schema";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: vi.fn(() => false) };
});

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return { ...actual, wgwIsGuestSession: vi.fn(() => true) };
});

const live = vi.hoisted(() => ({
  renameItem: vi.fn(),
  setStar: vi.fn(),
  listDirectory: vi.fn(),
}));

vi.mock("@/lib/api/wgw/drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/drive")>();
  return { ...actual, createWgwDriveOperations: vi.fn(() => live) };
});

const guest = "share:guest-1713";

describe("createDocsFileOperations for a guest session", () => {
  beforeEach(async () => {
    vi.mocked(wgwIsGuestSession).mockReturnValue(true);
    live.renameItem.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    live.setStar.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    live.listDirectory.mockReset().mockResolvedValue({ entries: [] });
    await offlineDbForAccount(offlineAccountKeyFromUsername(guest)).outbox.clear();
  });

  it("never queues a rename or star while offline, and lists from the server", async () => {
    const operations = createDocsFileOperations(guest);

    await expect(
      operations.renameItem({
        from: "/users/admin/Shared/Plan.md",
        destination: "/users/admin/Shared",
        to: "Renamed.md",
      }),
    ).rejects.toThrow();
    await expect(
      operations.setStar({ path: "/users/admin/Shared/Plan.md", starred: true }),
    ).rejects.toThrow();
    await operations.listDirectory("/users/admin/Shared");

    expect(live.listDirectory).toHaveBeenCalled();
    expect(await listOutboxMutations(guest)).toEqual([]);
  });

  it("still queues offline writes for a signed-in account", async () => {
    vi.mocked(wgwIsGuestSession).mockReturnValue(false);
    await offlineDbForAccount(offlineAccountKeyFromUsername("alice")).outbox.clear();

    await createDocsFileOperations("alice").setStar({
      path: "/users/alice/Plan.md",
      starred: true,
    });

    expect((await listOutboxMutations("alice")).map((row) => row.op)).toEqual(["star"]);
  });
});
