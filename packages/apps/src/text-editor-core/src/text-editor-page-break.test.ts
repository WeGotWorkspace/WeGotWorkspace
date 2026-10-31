/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyContentSeedToYDoc,
  readContentFromYDoc,
} from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";

const editors: Editor[] = [];

function markdownEditor(content: string): Editor {
  const editor = new Editor({
    extensions: createTextEditorExtensions({ format: "markdown" }),
    content,
  });
  editors.push(editor);
  return editor;
}

function blockTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  return types;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("page break Markdown", () => {
  it("round-trips a page break byte-identical", () => {
    const markdown = "# Letter\n\nDear Sam,\n\n<!-- pagebreak -->\n\n## Appendix\n\nSigned.";
    const editor = markdownEditor(markdown);
    expect(blockTypes(editor)).toEqual([
      "heading",
      "paragraph",
      "pageBreak",
      "heading",
      "paragraph",
    ]);
    expect(getTextEditorContent(editor, "markdown")).toBe(markdown);
  });

  it("leaves a body without breaks unchanged", () => {
    const markdown =
      "# Minutes\n\nPresent: Sam, Kim.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---\n\nEnd.";
    expect(getTextEditorContent(markdownEditor(markdown), "markdown")).toBe(markdown);
  });

  it("reads a break written by another editor without blank lines", () => {
    const editor = markdownEditor("Before.\n<!-- pagebreak -->\nAfter.");
    expect(blockTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(editor.state.doc.textContent).toBe("Before.After.");
  });

  it("reads spacing and case variants, and leaves other comments alone", () => {
    expect(blockTypes(markdownEditor("A\n\n<!--   PageBreak  -->\n\nB"))).toContain("pageBreak");
    expect(blockTypes(markdownEditor("A\n\n<!-- note to self -->\n\nB"))).not.toContain(
      "pageBreak",
    );
  });

  it("writes two breaks in a row as two comments", () => {
    const markdown = "A\n\n<!-- pagebreak -->\n\n<!-- pagebreak -->\n\nB";
    expect(getTextEditorContent(markdownEditor(markdown), "markdown")).toBe(markdown);
  });
});

describe("setPageBreak", () => {
  it("inserts a break and puts the caret in the following text", () => {
    const editor = markdownEditor("First.\n\nSecond.");
    editor.commands.setTextSelection(7);
    expect(editor.commands.setPageBreak()).toBe(true);
    expect(blockTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("Second.");
    expect(getTextEditorContent(editor, "markdown")).toBe(
      "First.\n\n<!-- pagebreak -->\n\nSecond.",
    );
  });

  it("adds an empty paragraph after a break at the end", () => {
    const editor = markdownEditor("Only.");
    editor.commands.setTextSelection(6);
    editor.commands.setPageBreak();
    expect(blockTypes(editor)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it.each([
    ["a list item", "- one\n- two", "one"],
    ["a quote", "> quoted", "quoted"],
    ["a table cell", "| A | B |\n| --- | --- |\n| 1 | 2 |", "2"],
  ])("refuses a break inside %s and leaves the Markdown unchanged", (_, markdown, text) => {
    const editor = markdownEditor(markdown);
    const before = getTextEditorContent(editor, "markdown");
    let caret = -1;
    editor.state.doc.descendants((node, pos) => {
      if (caret < 0 && node.isText && node.text === text) caret = pos + text.length;
    });
    editor.commands.setTextSelection(caret);
    expect(editor.can().setPageBreak()).toBe(false);
    expect(editor.commands.setPageBreak()).toBe(false);
    expect(getTextEditorContent(editor, "markdown")).toBe(before);
    expect(blockTypes(editor)).not.toContain("pageBreak");
  });
});

describe("page break in collaboration", () => {
  it("survives a Yjs seed and read-back", () => {
    const markdown = "Before.\n\n<!-- pagebreak -->\n\nAfter.";
    const ydoc = new Y.Doc();
    applyContentSeedToYDoc(ydoc, markdown, "markdown");
    expect(readContentFromYDoc(ydoc, "markdown")).toBe(markdown);
  });

  it("is not part of plain-text documents", () => {
    const editor = new Editor({ extensions: createTextEditorExtensions({ format: "text" }) });
    editors.push(editor);
    expect(editor.schema.nodes.pageBreak).toBeUndefined();
  });
});
