/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { convertDocxToMarkdown } from "@/docs-core/src/docx-import/docx-to-markdown";
import { writeDocx } from "@/text-editor-core/src/export/docs-docx-writer";
import { docsExportPage } from "@/text-editor-core/src/export/docs-download-word";
import { editorJsonToExportBlocks } from "@/text-editor-core/src/export/text-editor-export-blocks";
import { readImageHeader } from "@/text-editor-core/src/export/text-editor-export-images";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";

const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const IMAGE_SRC = "drive:fn-0123456789abcdef0123456789abcdef";

const MARKDOWN = [
  "# Quote for Acme",
  "",
  "## Terms",
  "",
  "Intro with a [link](https://example.com).",
  "",
  "- One",
  "  - Nested",
  "- Two",
  "",
  "1. First",
  "2. Second",
  "",
  "> Quoted text",
  "",
  "```",
  "const a = 1;",
  "```",
  "",
  "| Item | Price |",
  "| --- | --- |",
  "| Design | 100 |",
  "",
  `![Logo](${IMAGE_SRC})`,
].join("\n");

async function roundTrip(markdown: string) {
  const editor = new Editor({
    extensions: createTextEditorExtensions({ format: "markdown" }),
    content: markdown,
  });
  try {
    const header = readImageHeader(PNG_1PX)!;
    const { blob } = await writeDocx(editorJsonToExportBlocks(editor.getJSON()), {
      title: "Round trip",
      page: docsExportPage({ format: "a4", orientation: "portrait" }),
      images: new Map([[IMAGE_SRC, { bytes: PNG_1PX, ...header }]]),
    });
    return await convertDocxToMarkdown(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    editor.destroy();
  }
}

describe("Doc → Word → import (#1618)", () => {
  it("comes back as the same Markdown: headings, lists, table header, code, quote, link, image", async () => {
    const { markdown, images } = await roundTrip(MARKDOWN);
    expect(images).toHaveLength(1);
    expect(images[0].bytes).toEqual(PNG_1PX);
    // The importer gives images a placeholder until they are uploaded.
    expect(markdown.trim().replace(images[0].placeholder, IMAGE_SRC)).toBe(MARKDOWN);
  });
});
