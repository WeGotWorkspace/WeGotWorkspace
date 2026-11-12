/** @vitest-environment jsdom */
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  editorJsonToExportBlocks,
  exportImageSources,
  exportRuns,
  type ExportBlock,
} from "./text-editor-export-blocks";
import { createExportFixtureEditor, EXPORT_FIXTURE_IMAGE_SRC } from "./text-editor-export-fixture";

const editors: Editor[] = [];

function fixtureBlocks(): ExportBlock[] {
  const editor = createExportFixtureEditor();
  editors.push(editor);
  return editorJsonToExportBlocks(editor.getJSON());
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("editorJsonToExportBlocks", () => {
  it("maps every block of the fixture Doc in order", () => {
    expect(fixtureBlocks().map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "taskList",
      "quote",
      "code",
      "divider",
      "table",
      "image",
      "pageBreak",
      "heading",
      "paragraph",
    ]);
  });

  it("keeps heading level and alignment from the live document", () => {
    const [heading] = fixtureBlocks();
    expect(heading).toMatchObject({ kind: "heading", level: 1, align: "center" });
  });

  it("maps inline formatting and links to runs", () => {
    const intro = fixtureBlocks()[1];
    expect(intro.kind).toBe("paragraph");
    const runs = intro.kind === "paragraph" ? intro.runs : [];
    expect(runs).toEqual(
      expect.arrayContaining([
        { kind: "text", text: "bold", bold: true },
        { kind: "text", text: "italic", italic: true },
        { kind: "text", text: "underline", underline: true },
        { kind: "text", text: "strike", strike: true },
        { kind: "text", text: "marked", highlight: true },
        { kind: "text", text: "code", code: true },
        { kind: "text", text: "our site", href: "https://example.com" },
      ]),
    );
  });

  it("keeps list nesting, the ordered start number and task state", () => {
    const blocks = fixtureBlocks();
    const bullets = blocks[2];
    expect(bullets).toMatchObject({ kind: "list", ordered: false });
    if (bullets.kind !== "list") throw new Error("expected a list");
    expect(bullets.items[0].blocks.map((b) => b.kind)).toEqual(["paragraph", "list"]);
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true, start: 3 });
    const tasks = blocks[4];
    if (tasks.kind !== "taskList") throw new Error("expected a task list");
    expect(tasks.items.map((i) => i.checked)).toEqual([false, true]);
  });

  it("keeps code block lines and language, the table header row and the image", () => {
    const blocks = fixtureBlocks();
    expect(blocks[6]).toEqual({
      kind: "code",
      text: "const a = 1;\nconst b = 2;",
      language: "js",
    });
    const table = blocks[8];
    if (table.kind !== "table") throw new Error("expected a table");
    expect(table.rows.map((r) => r.cells.map((c) => c.header))).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(blocks[9]).toEqual({
      kind: "image",
      src: EXPORT_FIXTURE_IMAGE_SRC,
      alt: "Logo",
      title: "",
    });
    expect(exportImageSources(blocks)).toEqual([EXPORT_FIXTURE_IMAGE_SRC]);
  });

  it("turns a hard break into a break run", () => {
    const last = fixtureBlocks().at(-1);
    expect(last).toEqual({
      kind: "paragraph",
      runs: [
        { kind: "text", text: "Line one" },
        { kind: "break" },
        { kind: "text", text: "line two" },
      ],
    });
  });

  it("gives an empty Doc one empty paragraph", () => {
    expect(editorJsonToExportBlocks({ type: "doc", content: [] })).toEqual([
      { kind: "paragraph", runs: [] },
    ]);
  });
});

describe("exportRuns (what Print shows)", () => {
  it("drops comment marks but keeps their text", () => {
    expect(
      exportRuns([
        { type: "text", text: "Hello ", marks: [] },
        { type: "text", text: "world", marks: [{ type: "comment", attrs: { id: "c1" } }] },
      ]),
    ).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  it("exports pending suggestions as accepted", () => {
    expect(
      exportRuns([
        { type: "text", text: "Price: " },
        { type: "text", text: "100", marks: [{ type: "deletion", attrs: { id: "s1" } }] },
        { type: "text", text: "120", marks: [{ type: "insertion", attrs: { id: "s1" } }] },
        { type: "text", text: " euro", marks: [{ type: "legacySuggestion" }] },
        {
          type: "text",
          text: "!",
          marks: [{ type: "bold" }, { type: "formatChange", attrs: { id: "s2" } }],
        },
      ]),
    ).toEqual([
      { kind: "text", text: "Price: 120 euro" },
      { kind: "text", text: "!", bold: true },
    ]);
  });

  it("drops a line break a pending suggestion deletes, as Print hides it", () => {
    expect(
      exportRuns([
        { type: "text", text: "Line one" },
        { type: "hardBreak", marks: [{ type: "deletion", attrs: { id: "s1" } }] },
        { type: "text", text: " and two" },
        { type: "hardBreak" },
        { type: "text", text: "Three" },
      ]),
    ).toEqual([
      { kind: "text", text: "Line one and two" },
      { kind: "break" },
      { kind: "text", text: "Three" },
    ]);
  });

  it("drops links that are not http(s), mailto or tel", () => {
    expect(
      exportRuns([
        {
          type: "text",
          text: "a",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
        { type: "text", text: "b", marks: [{ type: "link", attrs: { href: "mailto:a@b.test" } }] },
      ]),
    ).toEqual([
      { kind: "text", text: "a" },
      { kind: "text", text: "b", href: "mailto:a@b.test" },
    ]);
  });
});
