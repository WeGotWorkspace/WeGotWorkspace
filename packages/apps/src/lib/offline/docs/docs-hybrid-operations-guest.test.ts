import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUEST_UPLOAD_UNAVAILABLE } from "@/lib/api/wgw/drive";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { createHybridDocsDriveOperations } from "@/lib/offline/docs/docs-hybrid-operations";
import { queueNewDocsOfflineDocument } from "@/lib/offline/docs/docs-offline-pin-core";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: vi.fn(() => false) };
});

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return { ...actual, wgwIsGuestSession: vi.fn(() => true) };
});

/** Guest Drive operations: every write is refused (no guest write routes yet). */
const live = vi.hoisted(() => ({
  uploadFiles: vi.fn(),
  renameItem: vi.fn(),
  setStar: vi.fn(),
  listAllDirectoryEntries: vi.fn(async () => []),
  listStars: vi.fn(async () => []),
}));

vi.mock("@/lib/api/wgw/drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/drive")>();
  return { ...actual, createWgwDriveOperations: vi.fn(() => live) };
});

const guest = "share:guest-1713";

describe("createHybridDocsDriveOperations for a guest session", () => {
  beforeEach(async () => {
    vi.mocked(wgwIsGuestSession).mockReturnValue(true);
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    live.uploadFiles.mockReset().mockRejectedValue(new Error(GUEST_UPLOAD_UNAVAILABLE));
    live.renameItem.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    live.setStar.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    await offlineDbForAccount(offlineAccountKeyFromUsername(guest)).outbox.clear();
  });

  it("never queues a create, rename, trash or star while offline", async () => {
    const operations = createHybridDocsDriveOperations(guest);
    const file = new File(["# typed"], "Plan.md", { type: "text/markdown" });

    await expect(
      operations.uploadFiles({ cwd: "/users/admin/Shared", files: [file] }),
    ).rejects.toThrow(GUEST_UPLOAD_UNAVAILABLE);
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

    expect(await listOutboxMutations(guest)).toEqual([]);
  });

  it("refuses an offline new document instead of queueing it", async () => {
    await expect(queueNewDocsOfflineDocument(guest, "/users/admin/Shared/New.md")).rejects.toThrow(
      GUEST_UPLOAD_UNAVAILABLE,
    );

    expect(await listOutboxMutations(guest)).toEqual([]);
  });

  it("still queues offline writes for a signed-in account", async () => {
    vi.mocked(wgwIsGuestSession).mockReturnValue(false);
    const operations = createHybridDocsDriveOperations("alice");
    await offlineDbForAccount(offlineAccountKeyFromUsername("alice")).outbox.clear();

    await operations.setStar({ path: "/users/alice/Plan.md", starred: true });

    const outbox = await listOutboxMutations("alice");
    expect(outbox.map((row) => row.op)).toEqual(["star"]);
  });
});
