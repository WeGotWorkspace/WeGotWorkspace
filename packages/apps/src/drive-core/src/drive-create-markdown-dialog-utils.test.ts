import { describe, expect, it } from "vitest";
import {
  resolveCreateMarkdownDialogDefaults,
  splitMarkdownDialogDefaultName,
} from "@/drive-core/src/drive-create-markdown-dialog-utils";
import type { DriveFile } from "@/lib/files/drive-models";

const doc = (title: string): DriveFile => ({
  id: title,
  notebook: "File",
  category: "File",
  date: "Now",
  title,
  excerpt: "",
  body: [],
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "1 KB",
});

describe("resolveCreateMarkdownDialogDefaults", () => {
  it("uses the current folder view and a unique Untitled name", () => {
    const files = [doc("Untitled.md"), doc("Untitled 2.md")];
    expect(
      resolveCreateMarkdownDialogDefaults({ type: "folder", path: "My Drive/Projects" }, files),
    ).toEqual({
      defaultName: "Untitled 3.md",
      initialBrowsePath: "My Drive/Projects",
    });
  });

  it("falls back to My Drive when browsing Trash", () => {
    expect(resolveCreateMarkdownDialogDefaults({ type: "folder", path: "Trash" }, [])).toEqual({
      defaultName: "Untitled.md",
      initialBrowsePath: "My Drive",
    });
  });
});

describe("splitMarkdownDialogDefaultName", () => {
  it("splits the base name and locks .md", () => {
    expect(splitMarkdownDialogDefaultName("Untitled 2.md")).toEqual({
      baseName: "Untitled 2",
      extension: ".md",
    });
  });
});
