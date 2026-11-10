import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
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
    downloadFolder: vi.fn(async () => undefined),
    downloadSelection: vi.fn(async () => undefined),
    readFileBlob: vi.fn(),
    listStars: vi.fn(async () => []),
    listAllFiles: vi.fn(async () => ({ entries: [], nextOffset: 0, hasMore: false })),
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

function entry(path: string, name: string, time = 1): WgwDriveDirectoryEntry {
  return {
    path,
    name,
    type: "file",
    size: 100,
    time,
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

  it("opens a folder an upload has not created yet from its placeholders, also online", async () => {
    await writeDriveBootstrapToCache(username, bootstrap());
    await upsertDriveEntry(username, {
      ...entry("/users/alice/Projects", "Projects"),
      type: "dir",
      nodeId: "fn-projects",
    });
    const ops = createHybridDriveOperations(username, bootstrap());
    await ops.enqueueUploads!({
      cwd: "/users/alice/Projects",
      files: [],
      tree: { folders: ["Scans"], files: [{ file: new File(["x"], "a.pdf"), folder: "Scans" }] },
    });

    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const listing = await ops.listDirectory("/users/alice/Projects/Scans");
    const opened = await ops.changeDir("/users/alice/Projects/Scans");

    expect(listing.directory.files.map((file) => [file.name, file.upload?.status])).toEqual([
      ["a.pdf", "queued"],
    ]);
    expect(opened.cwd).toBe("/users/alice/Projects/Scans");
  });
});

describe("createHybridDriveOperations downloadFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the folder to the live operations while online", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      downloadFolder: ReturnType<typeof vi.fn>;
    };

    await ops.downloadFolder?.("/users/alice/Projects/");

    expect(live.downloadFolder).toHaveBeenCalledWith("/users/alice/Projects", undefined);
  });

  it("says a folder zip needs a connection while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      downloadFolder: ReturnType<typeof vi.fn>;
    };

    await expect(ops.downloadFolder?.("/users/alice/Projects")).rejects.toThrow(
      "Downloading a folder as a zip needs a connection.",
    );
    expect(live.downloadFolder).not.toHaveBeenCalled();
  });
});

describe("createHybridDriveOperations downloadSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the selection to the live operations while online", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      downloadSelection: ReturnType<typeof vi.fn>;
    };

    await ops.downloadSelection?.(["/users/alice/Projects/", "/users/alice/a.md"], "Personal");

    expect(live.downloadSelection).toHaveBeenCalledWith(
      ["/users/alice/Projects", "/users/alice/a.md"],
      "Personal",
      undefined,
    );
  });

  it("says a selection zip needs a connection while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      downloadSelection: ReturnType<typeof vi.fn>;
    };

    await expect(ops.downloadSelection?.(["/users/alice/a.md"], "Personal")).rejects.toThrow(
      "Downloading a folder as a zip needs a connection.",
    );
    expect(live.downloadSelection).not.toHaveBeenCalled();
  });
});

describe("createHybridDriveOperations listAllFiles", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.meta.clear();
    await upsertDriveEntry(username, entry("/users/alice/old.md", "old.md", 10));
    await upsertDriveEntry(username, entry("/users/alice/Projects/new.md", "new.md", 30));
    await upsertDriveEntry(username, entry("/groups/design/brief.md", "brief.md", 20));
    await upsertDriveEntry(username, {
      ...entry("/users/alice/Projects", "Projects", 40),
      type: "dir",
    });
    await upsertDriveEntry(username, entry("/users/alice/.Trash/gone.md", "gone.md", 50));
  });

  it("lists cached files of every drive newest first while offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const ops = createHybridDriveOperations(username, bootstrap());

    const first = await ops.listAllFiles?.({ offset: 0, limit: 2 });
    expect(first?.entries.map((file) => file.path)).toEqual([
      "/users/alice/Projects/new.md",
      "/groups/design/brief.md",
    ]);
    expect(first).toMatchObject({ nextOffset: 2, hasMore: true });

    const second = await ops.listAllFiles?.({ offset: 2, limit: 2 });
    expect(second?.entries.map((file) => file.path)).toEqual(["/users/alice/old.md"]);
    expect(second).toMatchObject({ nextOffset: 3, hasMore: false });
  });

  it("falls back to the cache when the live listing fails on the network", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      listAllFiles: ReturnType<typeof vi.fn>;
    };
    live.listAllFiles.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const page = await ops.listAllFiles?.({ offset: 0, limit: 10 });

    expect(live.listAllFiles).toHaveBeenCalled();
    expect(page?.entries).toHaveLength(3);
  });

  it("uses the live listing while online", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const ops = createHybridDriveOperations(username, bootstrap());
    const live = vi.mocked(createWgwDriveOperations).mock.results.at(-1)?.value as {
      listAllFiles: ReturnType<typeof vi.fn>;
    };
    live.listAllFiles.mockResolvedValueOnce({ entries: [], nextOffset: 0, hasMore: false });

    await expect(ops.listAllFiles?.({ offset: 0, limit: 10 })).resolves.toEqual({
      entries: [],
      nextOffset: 0,
      hasMore: false,
    });
  });
});
