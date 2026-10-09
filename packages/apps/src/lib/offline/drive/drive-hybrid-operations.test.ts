import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { createHybridDriveOperations } from "@/lib/offline/drive/drive-hybrid-operations";
import {
  upsertDriveEntry,
  writeDriveBootstrapToCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return {
    ...actual,
    readBrowserOnline: vi.fn(() => false),
  };
});

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    renameItem: vi.fn(),
    createFolder: vi.fn(),
    listAllDirectoryEntries: vi.fn(async () => []),
    uploadFiles: vi.fn(),
    downloadFile: vi.fn(),
    readFileBlob: vi.fn(),
    listStars: vi.fn(async () => []),
    setStar: vi.fn(),
    changeDir: vi.fn(),
    listDirectory: vi.fn(),
    refreshState: vi.fn(),
  })),
}));

const username = "alice";
const destination = "/users/alice";

function bootstrap(): DriveAppBootstrap {
  return {
    session: { user: { username, displayName: username } },
    data: {
      user: { username, name: username, role: "user", roots: [] },
      cwd: destination,
      directory: { location: destination, files: [] },
    },
  };
}

function entry(path: string, name: string): WgwDriveDirectoryEntry {
  return {
    path,
    name,
    type: "file",
    size: 100,
    time: 1,
    permissions: 644,
    myRights: fullDriveMyRights,
  };
}

describe("createHybridDriveOperations offline rename", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await driveEntriesTable(db).clear();
    await db.meta.clear();
  });

  it("returns cached directory entries after queuing an offline rename", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    await upsertDriveEntry(username, entry("/users/alice/old-name.md", "old-name.md"));
    await upsertDriveEntry(username, entry("/users/alice/other.md", "other.md"));

    const operations = createHybridDriveOperations(username, bootstrap());
    const data = await operations.renameItem({
      from: "/users/alice/old-name.md",
      destination,
      to: "new-name.md",
    });

    expect(data.directory.files.map((file) => file.path)).toEqual([
      "/users/alice/new-name.md",
      "/users/alice/other.md",
    ]);

    const outbox = await listOutboxMutationsForDomain(username, DRIVE_DOMAIN);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("rename");
  });
});
