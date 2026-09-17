import { describe, expect, it } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import type { DriveSharedWithMeEntry } from "@wgw-api-generated/drive-types";
import { mapDriveSharedWithMeEntries } from "@/drive-core/src/drive-shared-listing";
import { isDocsHomeCompatibleSharedFile } from "@/docs-core/src/docs-home-shared";

function sharedEntry(
  path: string,
  name: string,
  type: "file" | "dir" = "file",
): DriveSharedWithMeEntry {
  return {
    share: {
      id: `share-${name}`,
      path,
      kind: "member",
      defaultAccess: "view",
      publicToken: null,
      hasPassword: false,
      expiresAt: null,
      updatedAt: null,
      shareWith: null,
      myRights: fullDriveMyRights,
    },
    entry: {
      name,
      path,
      type,
      size: type === "dir" ? 0 : 10,
      time: 1,
      permissions: 0,
      myRights: fullDriveMyRights,
    },
  };
}

describe("mapDriveSharedWithMeEntries", () => {
  it("maps folders and all file kinds without Docs filtering", () => {
    const files = mapDriveSharedWithMeEntries(
      [
        sharedEntry("/users/bob/Notes.md", "Notes.md"),
        sharedEntry("/users/bob/Folder", "Folder", "dir"),
        sharedEntry("/users/bob/clip.mov", "clip.mov"),
      ],
      "alice",
    );
    expect(files.map((file) => file.title)).toEqual(["Notes.md", "Folder", "clip.mov"]);
  });
});

describe("Docs shared filter on Drive rows", () => {
  it("keeps only docs-compatible files", () => {
    const files = mapDriveSharedWithMeEntries(
      [
        sharedEntry("/users/bob/Notes.md", "Notes.md"),
        sharedEntry("/users/bob/Folder", "Folder", "dir"),
        sharedEntry("/users/bob/clip.mov", "clip.mov"),
      ],
      "alice",
    );
    expect(files.filter(isDocsHomeCompatibleSharedFile).map((file) => file.title)).toEqual([
      "Notes.md",
    ]);
  });
});
