import { describe, expect, it } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import type { WgwDriveDirectoryEntry } from "@wgw-api-generated/drive-types";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import {
  driveStarredPathMap,
  mapDriveStarredEntries,
} from "@/drive-core/src/drive-starred-listing";
import { mapDocsHomeStarredEntries } from "@/docs-core/src/use-docs-home-starred-list";

function entry(path: string, name: string, type: "file" | "dir" = "file"): WgwDriveDirectoryEntry {
  return {
    type,
    path,
    name,
    size: type === "dir" ? 0 : 42,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

describe("mapDriveStarredEntries", () => {
  it("maps every starred entry without Docs filtering", () => {
    const files = mapDriveStarredEntries(
      [
        entry("/users/alice/Plan.md", "Plan.md"),
        entry("/users/alice/Notes", "Notes", "dir"),
        entry("/users/alice/clip.mov", "clip.mov"),
      ],
      "alice",
    );
    expect(files.map((file) => file.title)).toEqual(["Plan.md", "Notes", "clip.mov"]);
  });
});

describe("driveStarredPathMap", () => {
  it("marks each path as starred", () => {
    expect(driveStarredPathMap(["/a", "/b"])).toEqual({ "/a": true, "/b": true });
  });
});

describe("mapDocsHomeStarredEntries", () => {
  it("keeps docs-compatible files and drops folders, binaries, and trash", () => {
    const driveFiles = mapDriveStarredEntries(
      [
        entry("/users/alice/Plan.md", "Plan.md"),
        entry("/users/alice/Notes", "Notes", "dir"),
        entry("/users/alice/clip.mov", "clip.mov"),
        entry("/users/alice/.Trash/Old.md", "Old.md"),
      ],
      "alice",
    );
    // Ensure trash parent is set like live Drive trash rows.
    const withTrashParent = driveFiles.map((file) =>
      file.title === "Old.md" ? { ...file, parent: "Trash" } : file,
    );
    expect(mapDocsHomeStarredEntries(withTrashParent).map((file) => file.title)).toEqual([
      "Plan.md",
    ]);
  });

  it("filters Drive files rather than remapping directory entries", () => {
    const file = driveFileFromEntry(entry("/users/alice/Plan.md", "Plan.md"), "alice");
    expect(mapDocsHomeStarredEntries([file])).toEqual([file]);
  });
});
