/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { findDocsImageToReplace } from "./use-docs-image-insert";

const A = "fn-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "fn-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function mount(content: string) {
  const el = document.createElement("div");
  document.body.append(el);
  return new Editor({
    element: el,
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: vi.fn(async () => new Blob([new Uint8Array([1])])),
    }),
    content,
  });
}

function imagePos(editor: Editor, src: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "image" && node.attrs.src === src) pos = at;
    return pos < 0;
  });
  return pos;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findDocsImageToReplace", () => {
  it("finds the same image again after the doc changed above it", () => {
    const editor = mount(`Intro\n\n![A](drive:${A})`);
    const src = `drive:${A}`;
    const target = { pos: imagePos(editor, src), src };
    editor.commands.insertContentAt(0, "<p>A new paragraph above</p>");
    expect(imagePos(editor, src)).not.toBe(target.pos);
    expect(findDocsImageToReplace(editor, target)).toBe(imagePos(editor, src));
    editor.destroy();
  });

  it("does not take over a different image, and reports a deleted one", () => {
    const editor = mount(`![A](drive:${A})\n\n![B](drive:${B})`);
    const target = { pos: imagePos(editor, `drive:${B}`), src: `drive:${B}` };
    editor.commands.deleteRange({ from: 0, to: target.pos });
    expect(findDocsImageToReplace(editor, target)).toBe(imagePos(editor, `drive:${B}`));
    editor.commands.setContent("<p>Nothing left</p>");
    expect(findDocsImageToReplace(editor, target)).toBeNull();
    editor.destroy();
  });
});
