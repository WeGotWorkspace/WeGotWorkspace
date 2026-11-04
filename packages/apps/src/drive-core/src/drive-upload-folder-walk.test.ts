import { describe, expect, it } from "vitest";
import {
  driveUploadTreeFromEntries,
  driveUploadTreeFromFileList,
  isSkippedUploadName,
} from "@/drive-core/src/drive-upload-folder-walk";

function picked(path: string): File {
  const file = new File([path], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

type FakeDir = { [name: string]: FakeDir | string };

/** A `FileSystemEntry` tree whose readers return `pageSize` entries per call. */
function entry(name: string, node: FakeDir | string, pageSize = 100): FileSystemEntry {
  if (typeof node === "string") {
    return {
      name,
      isFile: true,
      isDirectory: false,
      file: (resolve: (file: File) => void) => resolve(new File([node], name)),
    } as unknown as FileSystemEntry;
  }
  const children = Object.entries(node).map(([child, value]) => entry(child, value, pageSize));
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(offset, offset + pageSize);
          offset += batch.length;
          resolve(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

describe("folder upload tree (#1620)", () => {
  it("skips dot-names, Thumbs.db and desktop.ini", () => {
    expect(isSkippedUploadName(".DS_Store")).toBe(true);
    expect(isSkippedUploadName(".git")).toBe(true);
    expect(isSkippedUploadName("Thumbs.db")).toBe(true);
    expect(isSkippedUploadName("DESKTOP.INI")).toBe(true);
    expect(isSkippedUploadName("notes.txt")).toBe(false);
  });

  it("builds the tree of a webkitdirectory pick, parents first", () => {
    const tree = driveUploadTreeFromFileList([
      picked("Photos/2024/summer/beach.jpg"),
      picked("Photos/cover.jpg"),
      picked("Photos/.DS_Store"),
      picked("Photos/.git/config"),
      picked("Photos/.git/HEAD"),
      picked("Photos/2023/Thumbs.db"),
    ]);
    expect(tree.folders).toEqual(["Photos", "Photos/2024", "Photos/2024/summer"]);
    expect(tree.files.map((f) => [f.folder, f.file.name])).toEqual([
      ["Photos/2024/summer", "beach.jpg"],
      ["Photos", "cover.jpg"],
    ]);
    // .DS_Store, the .git folder once, Thumbs.db.
    expect(tree.skipped).toBe(3);
  });

  it("walks a dropped tree with nested and empty folders", async () => {
    const tree = await driveUploadTreeFromEntries([
      entry("Project", {
        "readme.md": "hi",
        src: { "main.ts": "x", lib: { "util.ts": "y" } },
        empty: {},
        ".cache": { "a.bin": "z" },
      }),
      entry("loose.txt", "loose"),
    ]);
    expect(tree.folders).toEqual(["Project", "Project/empty", "Project/src", "Project/src/lib"]);
    expect(tree.files.map((f) => `${f.folder}|${f.file.name}`).sort()).toEqual([
      "Project/src/lib|util.ts",
      "Project/src|main.ts",
      "Project|readme.md",
      "|loose.txt",
    ]);
    // The hidden folder counts once and is not read.
    expect(tree.skipped).toBe(1);
  });

  it("reads a directory until readEntries returns an empty batch", async () => {
    const many: FakeDir = {};
    for (let i = 0; i < 250; i += 1) many[`f${i}.txt`] = String(i);
    const tree = await driveUploadTreeFromEntries([entry("Big", many, 100)]);
    expect(tree.files).toHaveLength(250);
    expect(tree.folders).toEqual(["Big"]);
  });
});
