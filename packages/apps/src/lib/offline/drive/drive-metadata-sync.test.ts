import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  writeDocsAvailability,
  readDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import {
  readCachedDriveNodeId,
  readDriveEntryFromCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import "@/lib/offline/docs/docs-schema";
import "@/lib/offline/drive/drive-schema";

const listFileNodeEntries = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => true,
}));

vi.mock("@/lib/api/wgw/drive-jmap", () => ({
  driveJmapSession: vi.fn(async () => ({})),
  listFileNodeEntries,
}));

import { syncDriveMetadataTree } from "@/lib/offline/drive/drive-metadata-sync";

const username = "ada";

function bootstrap(): DriveAppBootstrap {
  return {
    session: { user: { displayName: "Ada", username } },
    data: {
      user: { username, name: "Ada", role: "user", roots: ["/users"] },
      cwd: "/users/ada",
      directory: { location: "/users/ada", files: [] },
    },
  };
}

function entry(
  path: string,
  nodeId: string,
  type: "file" | "dir" = "file",
): WgwDriveDirectoryEntry {
  return {
    type,
    path,
    name: path.split("/").pop() ?? path,
    size: 1,
    time: 1,
    permissions: 0,
    nodeId,
    myRights: {
      mayView: true,
      mayComment: false,
      mayReview: false,
      mayEditContent: true,
      mayManageStructure: true,
      mayShare: false,
    },
  };
}

describe("syncDriveMetadataTree JMAP node ids", () => {
  beforeEach(() => {
    listFileNodeEntries.mockReset();
    listFileNodeEntries.mockImplementation(async (_session: unknown, dir: string) => {
      if (dir === "/groups") return [];
      return [];
    });
  });

  it("fills nodeId on every crawled row and on a matching pin", async () => {
    listFileNodeEntries.mockImplementation(async (_session: unknown, dir: string) => {
      if (dir === "/groups") return [];
      if (dir === "/users/ada") {
        return [
          entry("/users/ada/notes.md", "fn-notes"),
          entry("/users/ada/Docs", "fn-docs", "dir"),
        ];
      }
      if (dir === "/users/ada/Docs") return [entry("/users/ada/Docs/readme.md", "fn-readme")];
      return [];
    });
    await writeDocsAvailability(username, { id: "users/ada/notes.md", location: "My Drive" });

    const progress = await syncDriveMetadataTree(username, bootstrap());
    expect(progress.failed).toBe(0);
    expect(progress.synced).toBeGreaterThan(0);

    const paths = ["users/ada/notes.md", "users/ada/Docs", "users/ada/Docs/readme.md"];
    for (const path of paths) {
      const row = await readDriveEntryFromCache(username, path);
      expect(row?.nodeId).toBeTruthy();
      expect(await readCachedDriveNodeId(username, path)).toBe(row?.nodeId);
    }
    expect(await readCachedDriveNodeId(username, "users/ada/notes.md")).toBe("fn-notes");
    expect(await readDocsAvailability(username, "users/ada/notes.md")).toMatchObject({
      id: "users/ada/notes.md",
      nodeId: "fn-notes",
    });
  });

  it("stores the same nodeId when a later crawl lists a second path", async () => {
    let renamed = false;
    listFileNodeEntries.mockImplementation(async (_session: unknown, dir: string) => {
      if (dir === "/groups") return [];
      if (dir !== "/users/ada") return [];
      return renamed
        ? [entry("/users/ada/renamed.md", "fn-same")]
        : [entry("/users/ada/original.md", "fn-same")];
    });

    await syncDriveMetadataTree(username, bootstrap());
    expect(await readCachedDriveNodeId(username, "users/ada/original.md")).toBe("fn-same");

    renamed = true;
    await syncDriveMetadataTree(username, bootstrap());

    expect(await readCachedDriveNodeId(username, "users/ada/renamed.md")).toBe("fn-same");
    expect(await readCachedDriveNodeId(username, "users/ada/original.md")).toBe("fn-same");
  });
});
