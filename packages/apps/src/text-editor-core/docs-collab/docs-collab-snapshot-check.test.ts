/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { writeNoteTitle } from "@/lib/collab/docs-collab-document-title";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { checkSnapshotText, isSameSave } from "./docs-collab-snapshot-check";

const RICH = [
  "# Plan",
  "",
  "Some **bold** and *italic* text with a [link](https://example.com).",
  "",
  "- one",
  "- two",
  "  - nested",
  "",
  "1. first",
  "2. second",
  "",
  "- [ ] open task",
  "- [x] done task",
  "",
  "> quoted",
  "",
  "```",
  "code",
  "```",
].join("\n");

function stateOf(markdown: string, title: string | null): Uint8Array {
  const doc = new Y.Doc();
  applyContentSeedToYDoc(doc, markdown, "markdown");
  if (title !== null) writeNoteTitle(doc, title);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe("checkSnapshotText", () => {
  it("matches a note with lists, task items, links and code after the editor round trip", () => {
    // The text a save stores is the editor's serialization; seeding that text
    // again must serialize to the same text, or every open would rebuild.
    const seeded = new Y.Doc();
    applyContentSeedToYDoc(seeded, RICH, "markdown");
    const saved = readContentFromYDoc(seeded, "markdown");
    seeded.destroy();
    const text = { markdown: saved, title: "Plan", etag: '"t1"' };
    expect(checkSnapshotText(stateOf(saved, "Plan"), text, "markdown", '"t1"')).toBe("match");
    expect(checkSnapshotText(stateOf(RICH, "Plan"), text, "markdown", '"t1"')).toBe("match");
  });

  it("finds another body or title when state and text are one save", () => {
    const text = { markdown: "Real\n", title: "Plan", etag: '"t1"' };
    expect(checkSnapshotText(stateOf("Planted", "Plan"), text, "markdown", '"t1"')).toBe(
      "mismatch",
    );
    expect(checkSnapshotText(stateOf("Real", "Other"), text, "markdown", '"t1"')).toBe("mismatch");
    expect(checkSnapshotText(new Uint8Array([0xff, 1, 2]), text, "markdown", '"t1"')).toBe(
      "undecodable",
    );
  });

  it("does not check a state and a text from two saves, or without a state tag", () => {
    const text = { markdown: "Real\n", title: "Plan", etag: '"t2"' };
    expect(checkSnapshotText(stateOf("Planted", "Plan"), text, "markdown", '"t1"')).toBe("match");
    expect(checkSnapshotText(stateOf("Planted", "Plan"), text, "markdown", null)).toBe("match");
  });

  it("treats a missing title type as a note's null title", () => {
    const text = { markdown: "Real\n", title: null, etag: '"t1"' };
    expect(checkSnapshotText(stateOf("Real", null), text, "markdown", '"t1"')).toBe("match");
    expect(checkSnapshotText(stateOf("Real", "Planted"), text, "markdown", '"t1"')).toBe(
      "mismatch",
    );
  });

  it("calls two reads one save only when both tags are present and equal", () => {
    expect(isSameSave('"a"', '"a"')).toBe(true);
    expect(isSameSave('"a"', '"b"')).toBe(false);
    expect(isSameSave(null, '"a"')).toBe(false);
    expect(isSameSave('"a"', undefined)).toBe(false);
  });
});
