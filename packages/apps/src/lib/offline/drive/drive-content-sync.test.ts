import { beforeEach, describe, expect, it, vi } from "vitest";

const { makeDocsOfflineAvailable, readDriveEntryFromCache } = vi.hoisted(() => ({
  makeDocsOfflineAvailable: vi.fn(),
  readDriveEntryFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/docs/docs-offline-pin-core", () => ({ makeDocsOfflineAvailable }));
vi.mock("@/lib/offline/drive/drive-directory-offline-store", () => ({ readDriveEntryFromCache }));
vi.mock("@/lib/offline/drive/drive-availability-store", () => ({
  markDriveAvailabilitySynced: vi.fn(),
  writeDriveAvailability: vi.fn(),
}));

import { syncDriveFileContent } from "@/lib/offline/drive/drive-content-sync";

describe("syncDriveFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the entry mtime in ms for a background sync", async () => {
    readDriveEntryFromCache.mockResolvedValue({ time: 20 });
    await syncDriveFileContent("alice", "/users/alice/a.md");
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      expect.any(String),
      "",
      expect.objectContaining({ modifiedAtMs: 20_000 }),
    );
  });

  it("treats a cached time of 0 as unknown so the document is refreshed", async () => {
    readDriveEntryFromCache.mockResolvedValue({ time: 0 });
    await syncDriveFileContent("alice", "/users/alice/a.md");
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      expect.any(String),
      "",
      expect.objectContaining({ modifiedAtMs: undefined }),
    );
  });
});
