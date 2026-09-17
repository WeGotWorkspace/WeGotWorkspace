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
import {
  deleteSelectedDocsImage,
  deselectDocsImage,
  insertDocsImageFromNodeId,
  isDocsImageNodeSelection,
} from "./text-editor-image-commands";
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

function findImagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "image") {
      pos = nodePos;
      return false;
    }
    return true;
  });
  return pos;
}

describe("docs image delete", () => {
  it("removes a selected image from the document without embedding blob urls", () => {
    const fetchImageContent = vi.fn(async () => PIXEL_PNG);
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
      content: `Intro\n\n![Cat](drive:${NODE_ID})\n\nOutro`,
    });
    const pos = findImagePos(editor);
    expect(pos).toBeGreaterThanOrEqual(0);
    editor.commands.setNodeSelection(pos);
    expect(isDocsImageNodeSelection(editor)).toBe(true);
    expect(deleteSelectedDocsImage(editor)).toBe(true);
    expect(findImageSrc(editor)).toBeNull();
    expect(getTextEditorContent(editor, "markdown")).not.toContain(`drive:${NODE_ID}`);
    expect(getTextEditorContent(editor, "markdown")).toContain("Intro");
    editor.destroy();
  });

  it("deselects a selected image on Escape without removing it", () => {
    const fetchImageContent = vi.fn(async () => PIXEL_PNG);
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
      content: `Intro\n\n![Cat](drive:${NODE_ID})\n\nOutro`,
    });
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(isDocsImageNodeSelection(editor)).toBe(true);
    expect(deselectDocsImage(editor)).toBe(true);
    expect(isDocsImageNodeSelection(editor)).toBe(false);
    expect(findImageSrc(editor)).toBe(`drive:${NODE_ID}`);
    expect(deselectDocsImage(editor)).toBe(false);
    editor.destroy();
  });

  it("deletes a selected image with Backspace and Delete", () => {
    const fetchImageContent = vi.fn(async () => PIXEL_PNG);
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
      content: `Intro\n\n![One](drive:${NODE_ID})\n\nOutro`,
    });
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(deleteSelectedDocsImage(editor)).toBe(true);
    expect(findImageSrc(editor)).toBeNull();
    editor.destroy();
  });
});
