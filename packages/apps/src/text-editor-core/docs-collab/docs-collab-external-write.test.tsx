import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readNoteTitle } from "./docs-collab-document-title";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { replaceDocumentWithExternalText } from "./docs-collab-external-write";

describe("replaceDocumentWithExternalText", () => {
  it("replaces the stale document with the outside text", () => {
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("stale-marker")]);
    ydoc.getXmlFragment("default").insert(0, [paragraph]);

    replaceDocumentWithExternalText(ydoc, "from outside", "Outside", "markdown");

    expect(readContentFromYDoc(ydoc)).toContain("from outside");
    expect(readContentFromYDoc(ydoc)).not.toContain("stale-marker");
    expect(readNoteTitle(ydoc)).toBe("Outside");
    ydoc.destroy();
  });

  /**
   * The seed client id comes from the text, so outside text that equals an
   * earlier seed maps onto items this document already holds. When the
   * person deleted those items since, the rebuild must still show the text.
   */
  it("restores outside text that equals an earlier seed the person deleted", () => {
    const original = "Upload test\nThe text from the upload.";
    const ydoc = new Y.Doc();
    applyContentSeedToYDoc(ydoc, original, "markdown");
    const text = ydoc.getXmlFragment("default").get(0) as Y.XmlElement;
    const inline = text.get(0) as Y.XmlText;
    inline.delete(0, inline.length);
    inline.insert(0, "Typed over all of it");

    replaceDocumentWithExternalText(ydoc, original, null, "markdown");

    expect(readContentFromYDoc(ydoc)).toContain("The text from the upload.");
    expect(readContentFromYDoc(ydoc)).not.toContain("Typed over all of it");
    ydoc.destroy();
  });

  it("converges two clients that rebuild the same state from the same text", () => {
    const stale = new Y.Doc();
    applyContentSeedToYDoc(stale, "Old text.", "markdown");
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, Y.encodeStateAsUpdate(stale));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(stale));

    replaceDocumentWithExternalText(first, "Outside text.", null, "markdown");
    replaceDocumentWithExternalText(second, "Outside text.", null, "markdown");
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));

    expect(readContentFromYDoc(first).split("Outside text.").length - 1).toBe(1);
    expect(readContentFromYDoc(first)).not.toContain("Old text.");
    for (const doc of [stale, first, second]) doc.destroy();
  });
});
