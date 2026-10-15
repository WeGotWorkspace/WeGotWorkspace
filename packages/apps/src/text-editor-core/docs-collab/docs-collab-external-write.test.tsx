import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readNoteTitle } from "./docs-collab-document-title";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
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
});
