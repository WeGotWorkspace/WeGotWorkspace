import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  noteTitleForSave,
  noteTitleIsInDoc,
  readNoteTitle,
  writeNoteTitle,
} from "@/notes-core/src/note-title-doc";

function sync(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
}

/** Pairs that corrupted a title when both sides seeded the same client id. */
const UNEQUAL_SUMMARIES = [
  ["Oude titel", "Nieuwe titel"],
  ["Kort", "Veel langere titel"],
  ["Veel langere titel", "Kort"],
  ["", "Titel"],
  ["Titel", ""],
  ["Foo", "Bar"],
  ["Foo", "Barbecue"],
] as const;

const SPLICED = ["Oude titelel", "Kort langere titel", "Foobecue", "itel"];

describe("note title in the Y.Doc", () => {
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

  it("shows unequal summaries and does not write them into the document", () => {
    for (const [localSummary, serverSummary] of UNEQUAL_SUMMARIES) {
      const local = new Y.Doc();
      const server = new Y.Doc();

      expect(readNoteTitle(local, localSummary)).toBe(localSummary);
      expect(readNoteTitle(server, serverSummary)).toBe(serverSummary);
      expect(noteTitleIsInDoc(local)).toBe(false);
      expect(noteTitleIsInDoc(server)).toBe(false);

      sync(local, server);

      expect(noteTitleIsInDoc(local)).toBe(false);
      expect(noteTitleIsInDoc(server)).toBe(false);
      expect(noteTitleForSave(local)).toBeUndefined();
      expect(readNoteTitle(local, localSummary)).toBe(localSummary);
      expect(readNoteTitle(server, serverSummary)).toBe(serverSummary);
      for (const spliced of SPLICED) {
        expect(readNoteTitle(local, localSummary)).not.toBe(spliced);
        expect(readNoteTitle(server, serverSummary)).not.toBe(spliced);
      }
    }
  });

  it("applies a later edit whole, without splicing the stored summary", () => {
    const local = new Y.Doc();
    const server = new Y.Doc();
    expect(readNoteTitle(local, "Oude titel")).toBe("Oude titel");
    expect(readNoteTitle(server, "Nieuwe titel")).toBe("Nieuwe titel");

    writeNoteTitle(server, "Nieuwe titel");
    sync(local, server);

    expect(readNoteTitle(local, "Oude titel")).toBe("Nieuwe titel");
    expect(readNoteTitle(server)).toBe("Nieuwe titel");
    expect(readNoteTitle(local)).not.toBe("Oude titelel");

    const edited = new Y.Doc();
    expect(readNoteTitle(edited, "Kort")).toBe("Kort");
    writeNoteTitle(edited, "Veel langere titel");
    expect(readNoteTitle(edited)).toBe("Veel langere titel");
    expect(readNoteTitle(edited)).not.toBe("Kort langere titel");

    const cleared = new Y.Doc();
    expect(readNoteTitle(cleared, "Titel")).toBe("Titel");
    writeNoteTitle(cleared, "");
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(cleared));
    expect(noteTitleIsInDoc(reloaded)).toBe(true);
    expect(readNoteTitle(reloaded, "Titel")).toBe("");
    expect(readNoteTitle(reloaded)).not.toBe("itel");
  });

  it("converges when two devices type the first title", () => {
    const left = new Y.Doc();
    const right = new Y.Doc();
    writeNoteTitle(left, "Foo");
    writeNoteTitle(right, "Barbecue");
    sync(left, right);

    expect(readNoteTitle(left)).toBe(readNoteTitle(right));
    expect(readNoteTitle(left)).toContain("Foo");
    expect(readNoteTitle(left)).toContain("Barbecue");
    expect(readNoteTitle(left)).not.toBe("Foobecue");
  });

  it("does not touch the doc when the title is unchanged", () => {
    const doc = new Y.Doc();
    const clockBefore = doc.store.clients.get(doc.clientID) ?? 0;
    expect(readNoteTitle(doc, "")).toBe("");
    expect(doc.share.has("note-title")).toBe(false);
    expect(doc.store.clients.get(doc.clientID) ?? 0).toBe(clockBefore);

    writeNoteTitle(doc, "Event");
    const encoded = Y.encodeStateAsUpdate(doc);
    writeNoteTitle(doc, "Event");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(encoded);

    writeNoteTitle(doc, "");
    const blank = Y.encodeStateAsUpdate(doc);
    writeNoteTitle(doc, "");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(blank);
    expect(readNoteTitle(doc)).toBe("");
  });

  it("reports the doc title for SUMMARY and omits it until the title type exists", () => {
    const doc = new Y.Doc();
    expect(noteTitleForSave(doc)).toBeUndefined();
    expect(readNoteTitle(doc, "Event")).toBe("Event");
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
