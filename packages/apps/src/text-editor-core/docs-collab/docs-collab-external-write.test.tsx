import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readNoteTitle } from "./docs-collab-document-title";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { isRemoteUpdateOrigin } from "./docs-collab-utils";
import {
  EXTERNAL_REBUILD_ORIGIN,
  replaceDocumentWithExternalText,
} from "./docs-collab-external-write";

describe("replaceDocumentWithExternalText", () => {
  it("replaces the stale document with the outside text", () => {
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("stale-marker")]);
    ydoc.getXmlFragment("default").insert(0, [paragraph]);

    replaceDocumentWithExternalText(
      ydoc,
      "from outside",
      "Outside",
      "markdown",
      Y.encodeStateAsUpdate(ydoc),
    );

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

    replaceDocumentWithExternalText(ydoc, original, null, "markdown", Y.encodeStateAsUpdate(ydoc));

    expect(readContentFromYDoc(ydoc)).toContain("The text from the upload.");
    expect(readContentFromYDoc(ydoc)).not.toContain("Typed over all of it");
    ydoc.destroy();
  });

  it("converges two clients that rebuild the same state from the same text", () => {
    const stale = new Y.Doc();
    applyContentSeedToYDoc(stale, "Old text.", "markdown");
    const serverState = Y.encodeStateAsUpdate(stale);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, Y.encodeStateAsUpdate(stale));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(stale));

    replaceDocumentWithExternalText(first, "Outside text.", null, "markdown", serverState);
    replaceDocumentWithExternalText(second, "Outside text.", null, "markdown", serverState);
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));

    expect(readContentFromYDoc(first).split("Outside text.").length - 1).toBe(1);
    expect(readContentFromYDoc(first)).not.toContain("Old text.");
    for (const doc of [stale, first, second]) doc.destroy();
  });

  it("converges when only one client holds extra local edits", () => {
    const stale = new Y.Doc();
    applyContentSeedToYDoc(stale, "Old text.", "markdown");
    const serverState = Y.encodeStateAsUpdate(stale);
    const clean = new Y.Doc();
    const busy = new Y.Doc();
    Y.applyUpdate(clean, Y.encodeStateAsUpdate(stale));
    Y.applyUpdate(busy, Y.encodeStateAsUpdate(stale));
    const inline = (busy.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText;
    inline.insert(0, "Local only. ");

    replaceDocumentWithExternalText(clean, "Outside text.", null, "markdown", serverState);
    replaceDocumentWithExternalText(busy, "Outside text.", null, "markdown", serverState);
    Y.applyUpdate(clean, Y.encodeStateAsUpdate(busy));

    expect(readContentFromYDoc(clean).split("Outside text.").length - 1).toBe(1);
    for (const doc of [stale, clean, busy]) doc.destroy();
  });

  /**
   * A peer that holds the same stale state but did not rebuild (an open tab
   * that has not read the server since) follows the rebuild it receives.
   */
  it("brings a peer that did not rebuild onto the outside text", () => {
    const stale = new Y.Doc();
    applyContentSeedToYDoc(stale, "Old text.", "markdown");
    const serverState = Y.encodeStateAsUpdate(stale);
    const openTab = new Y.Doc();
    Y.applyUpdate(openTab, serverState);
    const fresh = new Y.Doc();
    const published: Uint8Array[] = [];
    fresh.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === EXTERNAL_REBUILD_ORIGIN) published.push(update);
    });

    replaceDocumentWithExternalText(fresh, "Outside text.", null, "markdown", serverState);
    for (const update of published) Y.applyUpdate(openTab, update);

    expect(readContentFromYDoc(openTab)).toContain("Outside text.");
    expect(readContentFromYDoc(openTab)).not.toContain("Old text.");
    for (const doc of [stale, openTab, fresh]) doc.destroy();
  });

  it("deletes only the stale server history, not a peer's newer paragraph", () => {
    const stale = new Y.Doc();
    applyContentSeedToYDoc(stale, "Old text.", "markdown");
    const serverState = Y.encodeStateAsUpdate(stale);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, serverState);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Typed after the save.")]);
    peer.getXmlFragment("default").push([paragraph]);
    const rebuilding = new Y.Doc();
    Y.applyUpdate(rebuilding, Y.encodeStateAsUpdate(peer));

    replaceDocumentWithExternalText(rebuilding, "Outside text.", null, "markdown", serverState);

    expect(readContentFromYDoc(rebuilding)).toContain("Outside text.");
    expect(readContentFromYDoc(rebuilding)).toContain("Typed after the save.");
    expect(readContentFromYDoc(rebuilding)).not.toContain("Old text.");
    for (const doc of [stale, peer, rebuilding]) doc.destroy();
  });

  /** The join publishes every update whose origin is not a remote one. */
  it("publishes the rebuild to peers and other tabs like a local edit", () => {
    expect(isRemoteUpdateOrigin(EXTERNAL_REBUILD_ORIGIN, null)).toBe(false);
  });
});
