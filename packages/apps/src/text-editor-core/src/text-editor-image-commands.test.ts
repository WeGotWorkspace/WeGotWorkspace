/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { getTextEditorContent } from "./text-editor-content";
import {
  createCollaborativeTextEditorExtensions,
  createTextEditorExtensions,
} from "./text-editor-extensions";
import { insertDocsImageFromNodeId } from "./text-editor-image-commands";
import { getAcceptedTextEditorContent } from "./text-editor-track-changes";

const NODE_ID = "fn-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PIXEL_PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function findImageSrc(editor: Editor): string | null {
  let src: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") {
      src = typeof node.attrs.src === "string" ? node.attrs.src : null;
      return false;
    }
    return true;
  });
  return src;
}

describe("docs image parse/serialize", () => {
  it("round-trips drive:fn- and https images in markdown", () => {
    const fetchImageContent = vi.fn(async () => PIXEL_PNG);
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
      content: `![Cat](drive:${NODE_ID})\n\n![Remote](https://example.com/photo.png)`,
    });

    const srcs: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image" && typeof node.attrs.src === "string") {
        srcs.push(node.attrs.src);
      }
    });
    expect(srcs).toEqual([`drive:${NODE_ID}`, "https://example.com/photo.png"]);

    const markdown = getTextEditorContent(editor, "markdown");
    expect(markdown).toContain(`![Cat](drive:${NODE_ID})`);
    expect(markdown).toContain("![Remote](https://example.com/photo.png)");
    expect(markdown).not.toContain("blob:");
    expect(markdown).not.toContain("data:image");
    editor.destroy();
  });

  it("inserts drive:fn- via setImage and keeps attrs across Yjs", () => {
    const fetchImageContent = vi.fn(async () => PIXEL_PNG);
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = new Editor({
      extensions: createCollaborativeTextEditorExtensions({
        document: ydoc,
        awareness,
        user: { name: "Alex", color: "#2563eb" },
        format: "markdown",
        fetchImageContent,
      }),
    });

    expect(insertDocsImageFromNodeId(editor, NODE_ID, "Logo")).toBe(true);
    expect(findImageSrc(editor)).toBe(`drive:${NODE_ID}`);
    expect(getTextEditorContent(editor, "markdown")).toContain(`![Logo](drive:${NODE_ID})`);
    expect(getAcceptedTextEditorContent(editor, "markdown")).not.toContain("blob:");
    editor.destroy();
  });

  it("omits the Image extension for plain text docs", () => {
    const names = createTextEditorExtensions({ format: "text" }).map((ext) => ext.name);
    expect(names).not.toContain("image");
  });
});
