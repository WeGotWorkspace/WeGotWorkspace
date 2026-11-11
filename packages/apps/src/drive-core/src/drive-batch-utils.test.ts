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
  mergeDriveFolderListing,
  resolveDriveFileApiPath,
  restoreCompletedDriveMoves,
} from "@/drive-core/src/drive-batch-utils";

import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";

const USER = "alice";
const groupRoots = new Set<string>();
const EMPTY_DRIVE_UI: DriveUIData = {
  user: { username: USER, name: USER, role: "user", roots: ["/users"] },
  cwd: "",
  directory: { location: "", files: [] },
};

function driveFile(
  partial: Partial<DriveFile> & Pick<DriveFile, "id" | "title" | "parent">,
): DriveFile {
  return {
    notebook: "",
    category: "",
    date: "",
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    kind: "file",
    size: "1 KB",
    ...partial,
  };
}

describe("resolveDriveFileApiPath", () => {
  it("uses explicit apiPath when present", () => {
    const file = driveFile({
      id: "1",
      title: "doc.pdf",
      parent: "My Drive",
      apiPath: "/users/alice/doc.pdf",
    });
    expect(resolveDriveFileApiPath(file, USER, groupRoots)).toBe("/users/alice/doc.pdf");
  });

  it("derives api path from parent UI path and title", () => {
    const file = driveFile({ id: "2", title: "notes.md", parent: "My Drive/Projects" });
    expect(resolveDriveFileApiPath(file, USER, groupRoots)).toBe("/users/alice/Projects/notes.md");
  });
});

describe("mergeDriveFolderListing", () => {
  it("keeps optimistically staged files until server listing catches up", () => {
    const previous = [
      driveFile({
        id: "/users/alice/Projects/new.md",
        title: "new.md",
        parent: "My Drive/Projects",
      }),
      driveFile({
        id: "/users/alice/Projects/old.md",
        title: "old.md",
        parent: "My Drive/Projects",
      }),
    ];
    const nextData = {
      cwd: "/users/alice/Projects",
      directory: {
        location: "/users/alice/Projects",
        files: [
          {
            name: "old.md",
            path: "/users/alice/Projects/old.md",
            type: "file",
            size: 100,
            time: 1,
            permissions: 644,
          },
        ],
      },
    } as DriveUIData;
    const merged = mergeDriveFolderListing(previous, nextData, USER);
    expect(merged.map((file) => file.title)).toEqual(["old.md", "new.md"]);
  });

  it("does not retain staged files from other folders", () => {
    const previous = [
      driveFile({ id: "/users/alice/Inbox/new.md", title: "new.md", parent: "My Drive/Inbox" }),
    ];
    const nextData: DriveUIData = {
      ...EMPTY_DRIVE_UI,
      cwd: "/users/alice/Projects",
      directory: { location: "/users/alice/Projects", files: [] },
    };
    expect(mergeDriveFolderListing(previous, nextData, USER)).toEqual([]);
  });
});

describe("restoreCompletedDriveMoves", () => {
  beforeEach(() => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
  });

  it("restores the next file when one rename fails", async () => {
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => []),
      renameItem: vi
        .fn()
        .mockRejectedValueOnce(new Error("rename failed"))
        .mockResolvedValueOnce(undefined),
    } as unknown as DriveAPIOperations;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await restoreCompletedDriveMoves({
      operations,
      username: USER,
      groupRoots,
      completedKeys: new Set(["a", "b"]),
      moves: [
        {
          id: "a",
          title: "a.md",
          from: "/users/alice/.Trash/a.md",
          previousParent: "My Drive",
        },
        {
          id: "b",
          title: "b.md",
          from: "/users/alice/.Trash/b.md",
          previousParent: "My Drive",
        },
      ],
    });

    expect(result.restored).toEqual([]);
    expect(result.failures).toBe(1);
    expect(result.restoredToById).toEqual(new Map([["b", "b.md"]]));
    expect(operations.renameItem).toHaveBeenNthCalledWith(2, {
      destination: "/users/alice",
      from: "/users/alice/.Trash/b.md",
      to: "b.md",
    });
    expect(consoleError).toHaveBeenCalledWith("Drive batch restore failed", expect.any(Error));
    consoleError.mockRestore();
  });

  it("skips files the server never renamed", async () => {
    const operations = {
      listAllDirectoryEntries: vi.fn(async () => []),
      renameItem: vi.fn(async () => undefined),
    } as unknown as DriveAPIOperations;

    const result = await restoreCompletedDriveMoves({
      operations,
      username: USER,
      groupRoots,
      completedKeys: new Set(["a"]),
      moves: [
        {
          id: "a",
          title: "a.md",
          from: "/users/alice/.Trash/a.md",
          previousParent: "My Drive",
        },
        {
          id: "b",
          title: "b.md",
          from: "/users/alice/.Trash/b.md",
          previousParent: "My Drive",
        },
      ],
    });

    expect(result.failures).toBe(0);
    expect(operations.renameItem).toHaveBeenCalledTimes(1);
  });
});
