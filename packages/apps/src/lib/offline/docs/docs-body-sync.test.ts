import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { listingModifiedAtMs, syncDocsBodiesFromTree } from "@/lib/offline/docs/docs-body-sync";

const { makeDocsOfflineAvailable, withCrossTabLockIfFree, queryFileTreeView } = vi.hoisted(() => ({
  makeDocsOfflineAvailable: vi.fn(),
  withCrossTabLockIfFree: vi.fn(),
  queryFileTreeView: vi.fn(),
}));

vi.mock("@/lib/files/tree-view/tree-view-query", () => ({ queryFileTreeView }));

vi.mock("@/lib/offline/core/cross-tab-lock", () => ({ withCrossTabLockIfFree }));

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

function entry(path: string, time: number | undefined, size = 0): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path,
    name: path.split("/").pop() ?? path,
    size,
    time: time as number,
    permissions: 0,
  } as WgwDriveDirectoryEntry;
}

function treeRows(rows: WgwDriveDirectoryEntry[]): void {
  queryFileTreeView.mockResolvedValue({ rows, status: "ready" });
}

describe("syncDocsBodiesFromTree", () => {
  beforeEach(() => {
    makeDocsOfflineAvailable.mockReset();
    makeDocsOfflineAvailable.mockResolvedValue(undefined);
    queryFileTreeView.mockReset();
    withCrossTabLockIfFree.mockReset();
    withCrossTabLockIfFree.mockImplementation((_name: string, task: () => Promise<unknown>) =>
      task(),
    );
  });

  it("reads the Docs files of the local tree, not a server listing", async () => {
    treeRows([]);
    await syncDocsBodiesFromTree("alice");
    expect(queryFileTreeView).toHaveBeenCalledWith(
      "alice",
      { kind: "all" },
      { extensions: ["md", "markdown", "txt"], filesOnly: true },
      true,
    );
  });

  it("does not fetch the body of a doc whose collab room is held open", async () => {
    withCrossTabLockIfFree.mockImplementation(async (name: string, task: () => Promise<unknown>) =>
      name.includes("held.md") ? undefined : task(),
    );
    treeRows([entry("/users/alice/held.md", 10), entry("/users/alice/free.md", 10)]);

    await syncDocsBodiesFromTree("alice");

    expect(makeDocsOfflineAvailable).toHaveBeenCalledTimes(1);
    expect(makeDocsOfflineAvailable.mock.calls[0]?.[1]).toBe("/users/alice/free.md");
  });

  it("hydrates the tree's docs newest-first, skipping files over the size limit", async () => {
    treeRows([
      entry("/users/alice/todo.md", 10),
      entry("/groups/team/roadmap.txt", 20),
      entry("/users/alice/huge.md", 30, 64 * 1024 * 1024),
    ]);

    const result = await syncDocsBodiesFromTree("alice");

    expect(result.total).toBe(2);
    expect(result.synced).toBe(2);
    expect(makeDocsOfflineAvailable.mock.calls.map((call) => call[1])).toEqual([
      "/groups/team/roadmap.txt",
      "/users/alice/todo.md",
    ]);
    // Paced, and skipped when the local copy is newer than the row's time (s → ms).
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      "/groups/team/roadmap.txt",
      "Team: team",
      { beforeRequest: expect.any(Function), modifiedAtMs: 20_000 },
    );
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      "/users/alice/todo.md",
      "My Drive",
      { beforeRequest: expect.any(Function), modifiedAtMs: 10_000 },
    );
  });

  it("fetches a document whose row has no modification time", async () => {
    treeRows([entry("/users/alice/unknown.md", undefined)]);

    await syncDocsBodiesFromTree("alice");

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
