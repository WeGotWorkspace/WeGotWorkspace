import { describe, expect, it, vi } from "vitest";
import {
  claimDirectoryEntryName,
  ensureTrashFolder,
  mergeDriveFolderListing,
  resolveDriveFileApiPath,
  resolveTrashName,
} from "@/drive-core/src/drive-batch-utils";
import { DRIVE_TRASH_DIR_NAME } from "@/drive-core/src/drive-path-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";

const USER = "alice";
const groupRoots = new Set<string>();
const EMPTY_DRIVE_UI: DriveUIData = {
  user: { username: USER, name: USER, role: "user", roots: ["/users"] },
  cwd: "",
  directory: { location: "", files: [] },
  plugins: [],
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

describe("resolveTrashName", () => {
  it("returns the original name when trash is empty", () => {
    expect(resolveTrashName("Untitled.md", new Set())).toBe("Untitled.md");
  });

  it("increments the base name when the title already exists in trash", () => {
    const taken = new Set(["Untitled.md"]);
    expect(resolveTrashName("Untitled.md", taken)).toBe("Untitled 2.md");
  });

  it("keeps incrementing until a free trash name is found", () => {
    const taken = new Set(["report.md", "report 2.md"]);
    expect(resolveTrashName("report.md", taken)).toBe("report 3.md");
  });

  it("handles extensionless names", () => {
    const taken = new Set(["README"]);
    expect(resolveTrashName("README", taken)).toBe("README 2");
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
});
