import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  noteTitleForSave,
  noteTitleIsInDoc,
  readNoteTitle,
  seedNoteTitleOnOpen,
  titleFromNoteMarkdown,
  writeNoteTitle,
} from "@/notes-core/src/note-title-doc";

function sync(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
}

describe("note title in the Y.Doc", () => {
  it("takes a complete heading or first line, and ignores an in-progress line", () => {
    expect(titleFromNoteMarkdown("# Hello\n\nbody")).toBe("Hello");
    expect(titleFromNoteMarkdown("\n\nMeeting notes\nmore")).toBe("Meeting notes");
    expect(titleFromNoteMarkdown("Hello")).toBeNull();
    expect(titleFromNoteMarkdown("# Other")).toBeNull();
    expect(titleFromNoteMarkdown("A\n\nrest")).toBe("A");
  });

  it("merges offline title edits without dropping either side", () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    writeNoteTitle(left, "Base");
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

    writeNoteTitle(left, "Base alpha");
    writeNoteTitle(right, "Base beta");
    sync(left, right);

    const merged = readNoteTitle(left);
    expect(merged).toBe(readNoteTitle(right));
    expect(merged).toContain("alpha");
    expect(merged).toContain("beta");
    expect(merged).toContain("Base");
  });

  it("seeds SUMMARY once when two docs that lack a title merge", () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    left.getXmlFragment("default");
    right.getXmlFragment("default");

    expect(seedNoteTitleOnOpen(left, { summary: "Event" })).toBe("summary");
    expect(seedNoteTitleOnOpen(right, { summary: "Event" })).toBe("summary");
    sync(left, right);

    expect(readNoteTitle(left)).toBe("Event");
    expect(readNoteTitle(right)).toBe("Event");
    expect(seedNoteTitleOnOpen(left, { summary: "Other" })).toBe("skipped");
    expect(readNoteTitle(left)).toBe("Event");
  });

  it("seeds a create once from the first heading and then leaves the title alone", () => {
    const doc = new Y.Doc();
    expect(seedNoteTitleOnOpen(doc, { headingMarkdown: "Hello" })).toBe("skipped");
    expect(noteTitleIsInDoc(doc)).toBe(false);

    expect(seedNoteTitleOnOpen(doc, { headingMarkdown: "# Meeting\n\nNotes" })).toBe("heading");
    expect(readNoteTitle(doc)).toBe("Meeting");
    writeNoteTitle(doc, "Kept");
    expect(seedNoteTitleOnOpen(doc, { headingMarkdown: "# Other\n\nNotes" })).toBe("skipped");
    expect(readNoteTitle(doc)).toBe("Kept");
  });

  it("prefers SUMMARY over a heading, including a deliberate blank", () => {
    const titled = new Y.Doc();
    expect(
      seedNoteTitleOnOpen(titled, { summary: "Event", headingMarkdown: "# Other\n\nNotes" }),
    ).toBe("summary");
    expect(readNoteTitle(titled)).toBe("Event");

    const blank = new Y.Doc();
    const otherBlank = new Y.Doc();
    expect(seedNoteTitleOnOpen(blank, { summary: "" })).toBe("summary");
    expect(seedNoteTitleOnOpen(otherBlank, { summary: "" })).toBe("summary");
    sync(blank, otherBlank);
    expect(noteTitleIsInDoc(blank)).toBe(true);
    expect(readNoteTitle(blank)).toBe("");
    expect(readNoteTitle(otherBlank)).toBe("");
    expect(noteTitleForSave(blank)).toBe("");
  });

  it("reports the doc title for SUMMARY and omits it until the title type exists", () => {
    const doc = new Y.Doc();
    expect(noteTitleForSave(doc)).toBeUndefined();
    writeNoteTitle(doc, "Event");
    expect(noteTitleForSave(doc)).toBe("Event");
  });

  it("does not touch the body fragment Docs already uses", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("body")]);
    doc.getXmlFragment("default").insert(0, [paragraph]);
    const before = doc.getXmlFragment("default").toJSON();

    writeNoteTitle(doc, "Event");

    expect(doc.getXmlFragment("default").toJSON()).toEqual(before);
    expect(readNoteTitle(doc)).toBe("Event");
  });
});
