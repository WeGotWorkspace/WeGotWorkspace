import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listingModifiedAtMs,
  syncDocsBodiesFromHomeListing,
} from "@/lib/offline/docs/docs-body-sync";

const { makeDocsOfflineAvailable } = vi.hoisted(() => ({
  makeDocsOfflineAvailable: vi.fn(),
}));

vi.mock("@/lib/offline/docs/docs-offline-pin-core", () => ({
  makeDocsOfflineAvailable,
}));

vi.mock("@/lib/offline/core/offline-device-settings", () => ({
  readOfflineDeviceContentSettings: vi.fn(() => ({
    contentSyncEnabled: true,
    maxFileSizeBytes: 8 * 1024 * 1024,
  })),
  isEligibleForAutoContentSync: vi.fn(
    (_size: number, settings: { maxFileSizeBytes: number }) => _size <= settings.maxFileSizeBytes,
  ),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
}));

describe("syncDocsBodiesFromHomeListing", () => {
  beforeEach(() => {
    makeDocsOfflineAvailable.mockReset();
    makeDocsOfflineAvailable.mockResolvedValue(undefined);
  });

  it("hydrates home-listed markdown/txt docs newest-first", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      results: [
        {
          id: 2,
          sourceType: "file",
          sourceKey: "groups/team/roadmap.txt",
          title: "roadmap.txt",
          extension: "txt",
          category: "document",
          size: 0,
          modifiedAt: 20,
          snippet: "",
        },
        {
          id: 1,
          sourceType: "file",
          sourceKey: "users/alice/todo.md",
          title: "todo.md",
          extension: "md",
          category: "document",
          size: 0,
          modifiedAt: 10,
          snippet: "",
        },
        {
          id: 3,
          sourceType: "file",
          sourceKey: "users/alice/photo.png",
          title: "photo.png",
          extension: "png",
          category: "image",
          size: 0,
          modifiedAt: 30,
          snippet: "",
        },
      ],
      hasMore: false,
    });

    const result = await syncDocsBodiesFromHomeListing("alice", { fetcher });

    expect(result.total).toBe(2);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(makeDocsOfflineAvailable).toHaveBeenCalledTimes(2);
    // Paced, and skipped when the local copy is newer than the listing's modifiedAt (s → ms).
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      "/groups/team/roadmap.txt",
      "Group: team",
      { beforeRequest: expect.any(Function), modifiedAtMs: 20_000 },
    );
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      "/users/alice/todo.md",
      "My Drive",
      { beforeRequest: expect.any(Function), modifiedAtMs: 10_000 },
    );
  });

  it("fetches a document whose listing has no modification time", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      results: [
        {
          id: 3,
          sourceType: "file",
          sourceKey: "users/alice/unknown.md",
          title: "unknown.md",
          extension: "md",
          category: "document",
          size: 0,
          modifiedAt: null,
          snippet: "",
        },
      ],
      hasMore: false,
    });

    await syncDocsBodiesFromHomeListing("alice", { fetcher });

    // `undefined` makes makeDocsOfflineAvailable fetch; 0 would keep any local copy forever.
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      "/users/alice/unknown.md",
      "My Drive",
      { beforeRequest: expect.any(Function), modifiedAtMs: undefined },
    );
  });
});

describe("listingModifiedAtMs", () => {
  it("converts seconds to ms and treats a missing time as unknown", () => {
    expect(listingModifiedAtMs(20)).toBe(20_000);
    expect(listingModifiedAtMs(null)).toBeUndefined();
    expect(listingModifiedAtMs(undefined)).toBeUndefined();
    expect(listingModifiedAtMs(0)).toBeUndefined();
  });
});
