/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  refreshDriveDirectoryCache,
  syncDriveMetadataTree,
} from "@/lib/offline/drive/drive-metadata-sync";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: vi.fn(() => true),
}));

const wgwFetch = vi.fn();

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: (...args: unknown[]) => wgwFetch(...args),
  wgwReadJson: async (res: Response) => res.json(),
}));

const username = "alice";

function entry(path: string, type: "file" | "dir" = "file"): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? path;
  return {
    type,
    path,
    name,
    size: type === "dir" ? 0 : 4,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

function listing(files: WgwDriveDirectoryEntry[]): Response {
  return new Response(JSON.stringify({ data: { location: "/", files } }), { status: 200 });
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

describe("drive metadata fetch prune", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(getConnectivitySnapshot).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.meta.clear();
  });

  it("leaves the cache alone when the folder fetch fails", async () => {
    await upsertDriveEntry(username, entry("/users/alice/still-here.md"));
    wgwFetch.mockResolvedValue(new Response("nope", { status: 500 }));

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

    wgwFetch.mockImplementation(async (url: string) => {
      if (url.includes("/groups")) return listing([]);
      if (url.includes(encodeURIComponent("/users/alice/nested"))) {
        return new Response("nope", { status: 503 });
      }
      if (url.includes(encodeURIComponent("/users/alice"))) {
        return listing([entry("/users/alice/keep.md"), entry("/users/alice/nested", "dir")]);
      }
      return listing([]);
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
