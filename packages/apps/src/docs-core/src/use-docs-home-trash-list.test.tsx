import { describe, expect, it } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import type { WgwDriveDirectoryEntry } from "@wgw-api-generated/drive-types";
import { mapDriveTrashEntries } from "@/drive-core/src/drive-trash-listing";
import { mapDocsHomeTrashEntries } from "@/docs-core/src/use-docs-home-trash-list";

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

describe("mapDriveTrashEntries", () => {
  it("maps trash directory entries without Docs filtering", () => {
    const files = mapDriveTrashEntries(
      [
        entry("/users/alice/.Trash/Plan.md", "Plan.md"),
        entry("/users/alice/.Trash/Old", "Old", "dir"),
        entry("/users/alice/.Trash/clip.mov", "clip.mov"),
      ],
      "alice",
    );
    expect(files.map((file) => file.title)).toEqual(["Plan.md", "Old", "clip.mov"]);
    expect(files[0]?.parent).toBe("Trash");
  });
});

describe("mapDocsHomeTrashEntries", () => {
  it("keeps docs-compatible trash files and drops folders and binaries", () => {
    const files = mapDocsHomeTrashEntries(
      mapDriveTrashEntries(
        [
          entry("/users/alice/.Trash/Plan.md", "Plan.md"),
          entry("/users/alice/.Trash/Old", "Old", "dir"),
          entry("/users/alice/.Trash/clip.mov", "clip.mov"),
        ],
        "alice",
      ),
    );
    expect(files.map((file) => file.title)).toEqual(["Plan.md"]);
    expect(files[0]?.parent).toBe("Trash");
  });
});
