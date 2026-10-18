/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import {
  readCachedDriveNodeId,
  readDirectoryEntriesFromCache,
  readDriveEntryFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import "@/lib/offline/docs/docs-schema";

const listFileNodeEntries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
}));

vi.mock("@/lib/api/wgw/drive-jmap", () => ({
  driveJmapSession: vi.fn(async () => ({})),
  listFileNodeEntries,
}));

import {
  refreshDriveDirectoryCache,
  syncDriveMetadataTree,
} from "@/lib/offline/drive/drive-metadata-sync";

const username = "alice";

function entry(
  path: string,
  type: "file" | "dir" = "file",
  nodeId?: string,
): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? path;
  return {
    type,
    path,
    name,
    size: type === "dir" ? 0 : 4,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
    ...(nodeId ? { nodeId } : {}),
  };
}

function bootstrap(): DriveAppBootstrap {
  return {
    session: { user: { username, displayName: username } },
    data: {
      user: { username, name: username, role: "user", roots: ["/users", "/groups"] },
      cwd: `/users/${username}`,
      directory: { location: `/users/${username}`, files: [] },
    },
  };
}

function listDirectories(byDir: Record<string, WgwDriveDirectoryEntry[] | Error>): void {
  listFileNodeEntries.mockImplementation(async (_session: unknown, dir: string) => {
    const listed = byDir[dir];
    if (listed instanceof Error) throw listed;
    return listed ?? [];
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  listFileNodeEntries.mockReset();
  listDirectories({});
  vi.mocked(getConnectivitySnapshot).mockReturnValue(true);
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).clear();
  await db.meta.clear();
});

describe("syncDriveMetadataTree JMAP node ids", () => {
  it("fills nodeId on every crawled row and on a matching pin", async () => {
    listDirectories({
      "/users/alice": [
        entry("/users/alice/notes.md", "file", "fn-notes"),
        entry("/users/alice/Docs", "dir", "fn-docs"),
      ],
      "/users/alice/Docs": [entry("/users/alice/Docs/readme.md", "file", "fn-readme")],
    });
    await writeDocsAvailability(username, { id: "users/alice/notes.md", location: "My Drive" });

    const progress = await syncDriveMetadataTree(username, bootstrap());
    expect(progress.failed).toBe(0);
    expect(progress.synced).toBeGreaterThan(0);

    const paths = ["users/alice/notes.md", "users/alice/Docs", "users/alice/Docs/readme.md"];
    for (const path of paths) {
      const row = await readDriveEntryFromCache(username, path);
      expect(row?.nodeId).toBeTruthy();
      expect(await readCachedDriveNodeId(username, path)).toBe(row?.nodeId);
    }
    expect(await readCachedDriveNodeId(username, "users/alice/notes.md")).toBe("fn-notes");
    expect(await readDocsAvailability(username, "users/alice/notes.md")).toMatchObject({
      id: "users/alice/notes.md",
      nodeId: "fn-notes",
    });
  });

  it("keeps the nodeId on the new path after a rename and prunes the old path", async () => {
    listDirectories({ "/users/alice": [entry("/users/alice/original.md", "file", "fn-same")] });
    await syncDriveMetadataTree(username, bootstrap());
    expect(await readCachedDriveNodeId(username, "users/alice/original.md")).toBe("fn-same");

    listDirectories({ "/users/alice": [entry("/users/alice/renamed.md", "file", "fn-same")] });
    await syncDriveMetadataTree(username, bootstrap());

    expect(await readCachedDriveNodeId(username, "users/alice/renamed.md")).toBe("fn-same");
    expect(await readCachedDriveNodeId(username, "users/alice/original.md")).toBeUndefined();
  });
});

describe("drive metadata fetch prune", () => {
  it("leaves the cache alone when the folder fetch fails", async () => {
    await upsertDriveEntry(username, entry("/users/alice/still-here.md"));
    listDirectories({ "/users/alice": new Error("FileNode/query failed (500)") });

    await expect(refreshDriveDirectoryCache(username, "/users/alice")).rejects.toThrow(
      /failed \(500\)/,
    );

    const paths = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.path,
    );
    expect(paths).toEqual(["/users/alice/still-here.md"]);
  });

  it("prunes a successful folder inside the tree crawl and skips a folder whose fetch failed", async () => {
    await upsertDriveEntry(username, entry("/users/alice/gone.md"));
    await upsertDriveEntry(username, entry("/users/alice/keep.md"));
    await upsertDriveEntry(username, entry("/users/alice/nested/stay.md"));

    listDirectories({
      "/users/alice": [entry("/users/alice/keep.md"), entry("/users/alice/nested", "dir")],
      "/users/alice/nested": new Error("FileNode/query failed (503)"),
    });

    const progress = await syncDriveMetadataTree(username, bootstrap());

    expect(progress.failed).toBe(1);
    const home = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.name,
    );
    expect(home.sort()).toEqual(["keep.md", "nested"]);
    const nested = (await readDirectoryEntriesFromCache(username, "/users/alice/nested")).map(
      (row) => row.name,
    );
    expect(nested).toEqual(["stay.md"]);
  });
});
