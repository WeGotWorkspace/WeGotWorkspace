import { afterEach, describe, expect, it, vi } from "vitest";
import {
  driveGridRowKeyByFileId,
  driveGridRows,
  driveGridTrackCount,
} from "@/drive-core/src/drive-grid-rows";
import type { DriveFile } from "@/lib/files/drive-models";

const file = (id: string, kind: DriveFile["kind"] = "doc") => ({ id, kind }) as DriveFile;

describe("driveGridRows", () => {
  it("puts folders, then files, in rows of the column count under their headings", () => {
    const rows = driveGridRows(
      [file("d1", "folder"), file("d2", "folder"), file("d3", "folder")],
      [file("f1"), file("f2")],
      2,
    );
    expect(
      rows.map((row) =>
        row.kind === "header"
          ? `${row.section}${row.after ? " (after)" : ""}`
          : `${row.files.map((f) => f.id).join(",")}${row.last ? " (last)" : ""}`,
      ),
    ).toEqual(["folders", "d1,d2", "d3 (last)", "files (after)", "f1,f2 (last)"]);
  });

  it("leaves out an empty section, and the first heading has no gap above it", () => {
    const rows = driveGridRows([], [file("f1")], 4);
    expect(rows[0]).toMatchObject({ kind: "header", section: "files", after: false });
    expect(rows).toHaveLength(2);
  });

  it("keys rows by column count and first tile, and maps each tile to its row", () => {
    const rows = driveGridRows([], [file("f1"), file("f2"), file("f3")], 2);
    expect(rows.map((row) => row.key)).toEqual([
      "drive-grid-files",
      "drive-grid-2-f1",
      "drive-grid-2-f3",
    ]);
    expect(driveGridRowKeyByFileId(rows).get("f2")).toBe("drive-grid-2-f1");
  });
});

describe("driveGridTrackCount", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withTracks = (gridTemplateColumns: string) => {
    vi.stubGlobal("getComputedStyle", () => ({ gridTemplateColumns }));
    return driveGridTrackCount({} as Element);
  };

  it("counts the computed tracks, and gives up on an unresolved repeat()", () => {
    expect(withTracks("280px 280px 280px")).toBe(3);
    expect(withTracks("repeat(auto-fill, minmax(280px, 1fr))")).toBeNull();
    expect(withTracks("none")).toBeNull();
  });
});
