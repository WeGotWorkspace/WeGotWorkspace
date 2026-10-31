/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { textEditorPaginationOptions } from "./text-editor-pagination";

const A4 = { format: "a4", orientation: "portrait", layout: "pages" } as const;
const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.head.querySelectorAll("style[data-rm-pagination-style]").forEach((s) => s.remove());
});

describe("Docs pagination", () => {
  it("adds pagination only when a page setup is passed", () => {
    const notes = createTextEditorExtensions({ format: "markdown" }).map((ext) => ext.name);
    expect(notes).not.toContain("PaginationPlus");
    const docs = createTextEditorExtensions({
      format: "markdown",
      pagination: { setup: A4, enabled: true },
    }).map((ext) => ext.name);
    expect(docs).toContain("PaginationPlus");
  });

  it("maps the page setup to the library: page size, 1 inch margins, no header or footer", () => {
    expect(
      textEditorPaginationOptions({ ...A4, format: "letter", orientation: "landscape" }, true),
    ).toMatchObject({
      enabled: true,
      pageWidth: 1056,
      pageHeight: 816,
      marginTop: 96,
      marginBottom: 96,
      marginLeft: 96,
      marginRight: 96,
      contentMarginTop: 0,
      contentMarginBottom: 0,
      headerLeft: "",
      footerRight: "",
    });
  });

  it("marks the editor root only while pages show, and adds one library style", async () => {
    const make = (enabled: boolean) => {
      const element = document.createElement("div");
      document.body.append(element);
      const editor = new Editor({
        element,
        extensions: createTextEditorExtensions({
          format: "markdown",
          pagination: { setup: A4, enabled },
        }),
        content: "Hello",
      });
      editors.push(editor);
      return editor;
    };
    const paged = make(true);
    const continuous = make(false);
    // TipTap runs `onCreate` on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(paged.view.dom.classList.contains("rm-with-pagination")).toBe(true);
    expect(continuous.view.dom.classList.contains("rm-with-pagination")).toBe(false);
    // Our stylesheet owns the page box, not the library's inline styles.
    expect(paged.view.dom.style.width).toBe("");
    expect(document.head.querySelectorAll("style[data-rm-pagination-style]")).toHaveLength(1);
  });

  it("does not change the stored Markdown", () => {
    const markdown = "# Title\n\nBody.\n\n<!-- pagebreak -->\n\nMore.";
    const editor = new Editor({
      extensions: createTextEditorExtensions({
        format: "markdown",
        pagination: { setup: A4, enabled: true },
      }),
      content: markdown,
    });
    editors.push(editor);
    expect(getTextEditorContent(editor, "markdown")).toBe(markdown);
  });
});
