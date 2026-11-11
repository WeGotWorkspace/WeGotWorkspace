import { beforeEach, describe, expect, it, vi } from "vitest";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return {
    ...actual,
    readBrowserOnline: vi.fn(() => true),
  };
});
import {
  claimDirectoryEntryName,
  ensureTrashFolder,
  resolveFreeName,
} from "@/lib/files/drive-entry-names";
import { DRIVE_TRASH_DIR_NAME } from "@/lib/files/drive-path-utils";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";

const USER = "alice";

describe("resolveFreeName", () => {
  it("returns the original name when trash is empty", () => {
    expect(resolveFreeName("Untitled.md", new Set())).toBe("Untitled.md");
  });

  it("increments the base name when the title already exists in trash", () => {
    const taken = new Set(["Untitled.md"]);
    expect(resolveFreeName("Untitled.md", taken)).toBe("Untitled 2.md");
  });

  it("keeps incrementing until a free trash name is found", () => {
    const taken = new Set(["report.md", "report 2.md"]);
    expect(resolveFreeName("report.md", taken)).toBe("report 3.md");
  });

  it("handles extensionless names", () => {
    const taken = new Set(["README"]);
    expect(resolveFreeName("README", taken)).toBe("README 2");
  });
});

describe("ensureTrashFolder", () => {
  const groupRoots = new Set<string>();
  const data = {} as DriveUIData;

  it("skips create when .Trash is already listed under the user root", async () => {
    const createFolder = vi.fn(async () => data);
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => [
        { name: DRIVE_TRASH_DIR_NAME, path: "/users/alice/.Trash", type: "dir" },
      ]),
      createFolder,
    } as unknown as DriveAPIOperations;

    await ensureTrashFolder(operations, USER, groupRoots);

    expect(createFolder).not.toHaveBeenCalled();
  });

  it("creates .Trash when it is missing from the user root listing", async () => {
    const createFolder = vi.fn(async () => data);
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => []),
      createFolder,
    } as unknown as DriveAPIOperations;

    await ensureTrashFolder(operations, USER, groupRoots);

    expect(createFolder).toHaveBeenCalledWith(
      { cwd: "/users/alice", name: DRIVE_TRASH_DIR_NAME },
      expect.objectContaining({ refreshState: false }),
    );
  });
});

describe("claimDirectoryEntryName", () => {
  beforeEach(() => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
  });

  it("keeps a free title and disambiguates the next file that wants the same name", async () => {
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => [
        { name: "notes.md", path: "/users/alice/notes.md" },
      ]),
    } as unknown as DriveAPIOperations;
    const taken = new Map<string, Set<string>>();

    const first = await claimDirectoryEntryName(operations, "/users/alice", "notes.md", taken);
    const second = await claimDirectoryEntryName(operations, "/users/alice", "notes.md", taken);

    expect(first).toBe("notes 2.md");
    expect(second).toBe("notes 3.md");
    expect(operations.listAllDirectoryEntries).toHaveBeenCalledTimes(1);
  });

  it("rejects when the destination listing fails", async () => {
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => {
        throw new Error("list failed");
      }),
    } as unknown as DriveAPIOperations;

    await expect(
      claimDirectoryEntryName(operations, "/users/alice", "notes.md", new Map()),
    ).rejects.toThrow("list failed");
  });

  it("keeps the preferred name when the browser is offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    } as unknown as DriveAPIOperations;

    await expect(
      claimDirectoryEntryName(operations, "/users/alice", "notes.md", new Map()),
    ).resolves.toBe("notes.md");
    expect(operations.listAllDirectoryEntries).not.toHaveBeenCalled();
  });

  it("keeps the preferred name when the listing fails because the network is down", async () => {
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    } as unknown as DriveAPIOperations;

    await expect(
      claimDirectoryEntryName(operations, "/users/alice", "notes.md", new Map()),
    ).resolves.toBe("notes.md");
  });
});
