import { Editor } from "@tiptap/core";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";

/** Test fixture: a Doc with every construct the export writers cover. */
export const EXPORT_FIXTURE_IMAGE_SRC = "drive:fn-0123456789abcdef0123456789abcdef";

export const EXPORT_FIXTURE_MARKDOWN = [
  "# Quote for Acme",
  "",
  "Intro with **bold**, *italic*, <u>underline</u>, ~~strike~~, <mark>marked</mark>, `code` and [our site](https://example.com).",
  "",
  "- One",
  "  - Nested",
  "- Two",
  "",
  "3. Third",
  "4. Fourth",
  "",
  "- [ ] Open task",
  "- [x] Done task",
  "",
  "> Quoted text",
  "",
  "```js",
  "const a = 1;",
  "const b = 2;",
  "```",
  "",
  "---",
  "",
  "| Item | Price |",
  "| --- | --- |",
  "| Design | 100 |",
  "",
  `![Logo](${EXPORT_FIXTURE_IMAGE_SRC})`,
  "",
  "<!-- pagebreak -->",
  "",
  "## Terms",
  "",
  "Line one\\",
  "line two",
].join("\n");

/** A Docs Markdown editor with the fixture loaded and the first heading centred. */
export function createExportFixtureEditor(): Editor {
  const editor = new Editor({
    extensions: createTextEditorExtensions({ format: "markdown" }),
    content: EXPORT_FIXTURE_MARKDOWN,
  });
  editor.chain().setTextSelection(1).setTextAlign("center").run();
  return editor;
}
