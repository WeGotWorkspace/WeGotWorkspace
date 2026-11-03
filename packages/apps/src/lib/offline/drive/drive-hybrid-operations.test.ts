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

describe("createHybridDriveOperations readCachedDirectory", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.meta.clear();
  });

  it("returns cached folder rows while online", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    await upsertDriveEntry(username, entry("/users/alice/Projects/plan.md", "plan.md"));
    const ops = createHybridDriveOperations(username, bootstrap());

    const cached = await ops.readCachedDirectory?.("/users/alice/Projects");

    expect(cached?.cwd).toBe("/users/alice/Projects");
    expect(cached?.directory.files.map((file) => file.name)).toEqual(["plan.md"]);
  });

  it("returns null for a folder with no cached rows", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    const ops = createHybridDriveOperations(username, bootstrap());

    await expect(ops.readCachedDirectory?.("/users/alice/Empty")).resolves.toBeNull();
  });
});

describe("createHybridDriveOperations upload queue", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.table("drive_upload_items").clear();
    await db.table("drive_upload_batches").clear();
    await db.table("drive_upload_blobs").clear();
    await db.meta.clear();
  });

  it("queues files offline into a cached folder by its FileNode id and lists the placeholders", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    await upsertDriveEntry(username, {
      ...entry("/users/alice/Projects", "Projects"),
      type: "dir",
      nodeId: "fn-projects",
    });
    const ops = createHybridDriveOperations(username, bootstrap());

    const { batchId } = await ops.enqueueUploads!({
      cwd: "/users/alice/Projects",
      files: [new File(["x"], "scan.pdf", { type: "application/pdf" })],
    });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const items = await db.table("drive_upload_items").toArray();
    expect(items).toMatchObject([{ batchId, targetFolder: { kind: "server", id: "fn-projects" } }]);
    const listing = await ops.listDirectory("/users/alice/Projects");
    expect(listing.directory.files.map((file) => [file.name, file.upload?.status])).toEqual([
      ["scan.pdf", "queued"],
    ]);

    await ops.cancelUploadBatch!(batchId);
    expect(await db.table("drive_upload_items").count()).toBe(0);
  });

  it("refuses to queue into a folder whose id this device has never seen while offline", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    const ops = createHybridDriveOperations(username, bootstrap());

    await expect(
      ops.enqueueUploads!({ cwd: "/users/alice/Unknown", files: [new File(["x"], "a.pdf")] }),
    ).rejects.toThrow(/not available offline/);
  });
});
