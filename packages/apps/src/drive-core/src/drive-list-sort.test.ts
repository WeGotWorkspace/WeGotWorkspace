import { describe, expect, it } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { sortDriveFiles } from "@/drive-core/src/drive-list-sort";
import { nextListSort } from "@/lib/list-sort";

function file(title: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id: title,
    title,
    category: "File",
    date: "",
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "",
    ...extra,
  };
}

const titles = (files: DriveFile[]) => files.map((f) => f.title);

describe("sortDriveFiles", () => {
  const files = [
    file("file 10", { modifiedMs: 3, sizeBytes: 10 }),
    file("Beta", { kind: "folder", modifiedMs: 1 }),
    file("file 2", { modifiedMs: 2, sizeBytes: 500 }),
    file("alpha", { kind: "folder", modifiedMs: 4 }),
    file("no date"),
  ];

  it("sorts names naturally, folders first", () => {
    expect(titles(sortDriveFiles(files, { key: "name", direction: "asc" }))).toEqual([
      "alpha",
      "Beta",
      "file 2",
      "file 10",
      "no date",
    ]);
    expect(titles(sortDriveFiles(files, { key: "name", direction: "desc" }))).toEqual([
      "Beta",
      "alpha",
      "no date",
      "file 10",
      "file 2",
    ]);
  });

  it("sorts kind by its label, folders as a kind", () => {
    const mixed = [file("pic", { kind: "image" }), file("dir", { kind: "folder" }), file("doc")];
    expect(titles(sortDriveFiles(mixed, { key: "kind", direction: "asc" }))).toEqual([
      "doc",
      "dir",
      "pic",
    ]);
  });

  it("sorts dates on the timestamp, folders mixed in, missing dates last", () => {
    expect(titles(sortDriveFiles(files, { key: "modified", direction: "desc" }))).toEqual([
      "alpha",
      "file 10",
      "file 2",
      "Beta",
      "no date",
    ]);
    expect(titles(sortDriveFiles(files, { key: "modified", direction: "asc" }))).toEqual([
      "Beta",
      "file 2",
      "file 10",
      "alpha",
      "no date",
    ]);
    expect(titles(sortDriveFiles(files, { key: "size", direction: "asc" }))).toEqual([
      "file 10",
      "file 2",
      "alpha",
      "Beta",
      "no date",
    ]);
  });
});

describe("nextListSort", () => {
  it("starts a new column in its first direction and flips the same column", () => {
    const byName = { key: "name", direction: "asc" } as const;
    expect(nextListSort(byName, "size", "desc")).toEqual({ key: "size", direction: "desc" });
    expect(nextListSort(byName, "name", "asc")).toEqual({ key: "name", direction: "desc" });
  });
});
