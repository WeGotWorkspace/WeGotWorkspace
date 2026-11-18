import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";
import {
  EXTERNAL_REPLACE_ORIGIN,
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_TITLE,
  observeTextFieldsSeeds,
  readTextFields,
  readTextFieldsBase,
  readTextFieldsSeed,
  replaceTextFields,
  seedTextFields,
  type TextFieldsText,
} from "./docs-collab-text-fields";
import { rereadTextFields, type TextFieldsServerRead } from "./docs-collab-text-fields-reread";

const MILK = { title: "Groceries", description: "Buy milk" };
const OAT = { title: "Groceries", description: "Buy oat milk" };
const SOY = { title: "Groceries", description: "Buy soy milk" };

function seeded(text: TextFieldsText = MILK): Y.Doc {
  const doc = new Y.Doc();
  seedTextFields(doc, text, '"milk-tag"');
  observeTextFieldsSeeds(doc);
  return doc;
}

function copyOf(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc), "mesh");
  observeTextFieldsSeeds(copy);
  return copy;
}

function syncBoth(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), "mesh");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), "mesh");
}

function read(
  text: TextFieldsText,
  objectEtag: string,
  {
    storedState = null,
    externalWrite = false,
    stateContentTag = `"${objectEtag}-tag"`,
  }: Partial<TextFieldsServerRead> = {},
): TextFieldsServerRead {
  // By default the state and the text are one save (the tags agree).
  return {
    storedState,
    externalWrite,
    stateContentTag,
    text,
    contentTag: `"${objectEtag}-tag"`,
    objectEtag,
  };
}

function stateOf(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

function recordOrigins(doc: Y.Doc): unknown[] {
  const origins: unknown[] = [];
  doc.on("update", (_update, origin) => origins.push(origin));
  return origins;
}

const quiet = { pendingLocalWork: false };

describe("text-fields re-read, case 1: adopt", () => {
  it("adopts a peer's save once, with the server origin, seeding and publishing nothing", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    peer.getText(TEXT_FIELDS_BODY).insert(4, "oat ");
    const origins = recordOrigins(doc);

    expect(rereadTextFields(doc, read(OAT, "e2", { storedState: stateOf(peer) }), quiet)).toBe(
      "adopted",
    );

    expect(readTextFields(doc)).toEqual(OAT);
    expect(origins).toEqual([SERVER_ORIGIN]);
  });

  it("adopts on a document with no base yet and writes base from the snapshot's vector", () => {
    const writer = new Y.Doc();
    writer.getText(TEXT_FIELDS_TITLE).insert(0, OAT.title);
    writer.getText(TEXT_FIELDS_BODY).insert(0, OAT.description);
    const stored = stateOf(writer);
    const doc = new Y.Doc();

    expect(rereadTextFields(doc, read(OAT, "e2", { storedState: stored }), quiet)).toBe("adopted");

    expect(readTextFields(doc)).toEqual(OAT);
    const writerClock = Y.decodeStateVector(Y.encodeStateVector(writer)).get(writer.clientID);
    expect(readTextFieldsBase(doc)?.vector).toEqual({ [String(writer.clientID)]: writerClock });
  });

  it("writes base zero times when the snapshot already carries one", () => {
    const peer = seeded();
    const doc = new Y.Doc();
    const origins = recordOrigins(doc);

    rereadTextFields(doc, read(MILK, "e1", { storedState: stateOf(peer) }), quiet);

    expect(origins).toEqual([SERVER_ORIGIN]);
    expect(readTextFieldsBase(doc)?.vector).toEqual(readTextFieldsBase(peer)?.vector);
  });

  it("adopts a stored state saved after a missed replacement, keeping that replacement's seed", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    rereadTextFields(peer, read(OAT, "e2", { externalWrite: true }), quiet);
    const peerSeed = readTextFieldsSeed(peer);

    expect(rereadTextFields(doc, read(OAT, "e3", { storedState: stateOf(peer) }), quiet)).toBe(
      "adopted",
    );

    expect(readTextFields(doc)).toEqual(OAT);
    expect(readTextFieldsSeed(doc)).toBe(peerSeed);
  });
});

describe("text-fields re-read, offline edits", () => {
  it("drops a stale offline seed when a stored state is adopted, keeping typing on top", () => {
    const server = seeded({ title: "Buy milk", description: "" });
    server.getText(TEXT_FIELDS_TITLE).insert(8, " and eggs");
    const doc = new Y.Doc();
    seedTextFields(doc, { title: "Buy milk and eggs", description: "" }, '"x"');
    observeTextFieldsSeeds(doc);
    const text = { title: "Buy milk and eggs", description: "" };

    expect(rereadTextFields(doc, read(text, "e2", { storedState: stateOf(server) }), quiet)).toBe(
      "adopted",
    );
    expect(readTextFields(doc).title).toBe("Buy milk and eggs");
  });

  it("keeps an offline edit when there is no stored state and the text is what it took", () => {
    const doc = seeded();
    doc.getText(TEXT_FIELDS_BODY).insert(8, " typed offline");
    const base = readTextFieldsBase(doc);
    const served = read(MILK, "e1");
    served.contentTag = base?.contentTag ?? null;

    expect(rereadTextFields(doc, served, { pendingLocalWork: true })).toBe("unchanged");
    expect(readTextFields(doc).description).toBe("Buy milk typed offline");
  });

  it("asks when there is no stored state and the served text moved", () => {
    const doc = seeded();
    doc.getText(TEXT_FIELDS_BODY).insert(8, " typed offline");

    expect(rereadTextFields(doc, read(OAT, "e2"), { pendingLocalWork: true })).toBe("prompt");
  });
});

describe("text-fields re-read, case 2: the document already holds the text", () => {
  it("writes nothing when base already names the server tag, and is not also an adopt", () => {
    const doc = seeded();
    rereadTextFields(doc, read(OAT, "e2", { externalWrite: true }), quiet);
    const seed = readTextFieldsSeed(doc);
    const origins = recordOrigins(doc);

    expect(rereadTextFields(doc, read(OAT, "e2", { externalWrite: true }), quiet)).toBe(
      "unchanged",
    );

    expect(origins).toEqual([]);
    expect(readTextFieldsSeed(doc)).toBe(seed);
  });

  it("moves only a stale content tag on", () => {
    const doc = seeded();
    expect(rereadTextFields(doc, read(MILK, "e9"), quiet)).toBe("unchanged");
    expect(readTextFieldsBase(doc)?.contentTag).toBe('"e9-tag"');
    expect(readTextFields(doc)).toEqual(MILK);
  });
});

describe("text-fields re-read, case 3: quiet replacement", () => {
  it("replaces an outside write with a state, once", () => {
    const doc = seeded();
    const stored = stateOf(doc);
    expect(
      rereadTextFields(doc, read(SOY, "e2", { storedState: stored, externalWrite: true }), quiet),
    ).toBe("replaced");
    expect(readTextFields(doc)).toEqual(SOY);
  });

  it("ends on the server text when the stored state holds a third text", () => {
    const doc = seeded();
    const writer = copyOf(doc);
    writer.getText(TEXT_FIELDS_BODY).insert(4, "oat ");
    expect(
      rereadTextFields(
        doc,
        read(SOY, "e3", { storedState: stateOf(writer), externalWrite: true }),
        quiet,
      ),
    ).toBe("replaced");
    expect(readTextFields(doc)).toEqual(SOY);
  });

  it("replaces on a 204 and publishes only with the replace origin", () => {
    const doc = seeded();
    const origins = recordOrigins(doc);
    expect(rereadTextFields(doc, read(OAT, "e2"), quiet)).toBe("replaced");
    expect(readTextFields(doc)).toEqual(OAT);
    expect(new Set(origins)).toEqual(new Set([EXTERNAL_REPLACE_ORIGIN]));
  });

  it("gives a second document on the old seed the same text, by mesh or by its own re-read", () => {
    const a = seeded();
    const byMesh = copyOf(a);
    const byReread = copyOf(a);
    rereadTextFields(a, read(OAT, "e2"), quiet);
    syncBoth(a, byMesh);
    rereadTextFields(byReread, read(OAT, "e2"), quiet);
    syncBoth(a, byReread);
    for (const doc of [a, byMesh, byReread]) expect(readTextFields(doc)).toEqual(OAT);
  });

  it("treats a state that does not hold the served text as an outside write", () => {
    const doc = seeded();
    const planted = copyOf(doc);
    planted.getText(TEXT_FIELDS_BODY).insert(0, "Planted ");
    expect(rereadTextFields(doc, read(MILK, "e2", { storedState: stateOf(planted) }), quiet)).toBe(
      "unchanged",
    );
    expect(readTextFields(doc)).toEqual(MILK);
    const fresh = new Y.Doc();
    expect(
      rereadTextFields(fresh, read(MILK, "e2", { storedState: stateOf(planted) }), quiet),
    ).not.toBe("adopted");
    expect(readTextFields(fresh)).toEqual(MILK);
  });

  it("adopts a state from another save than the text read, with no replacement", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    peer.getText(TEXT_FIELDS_BODY).insert(4, "oat ");
    // A newer save landed between the two reads: the text is not the state's.
    const raced = read(SOY, "e3", { storedState: stateOf(peer), stateContentTag: '"e2-tag"' });
    expect(rereadTextFields(doc, raced, quiet)).toBe("adopted");
    expect(readTextFields(doc)).toEqual(OAT);
  });

  it("reseeds over six garbage bytes", () => {
    const doc = new Y.Doc();
    const garbage = new Uint8Array([0xff, 0x13, 0x07, 0x01, 0x02, 0x99]);
    expect(rereadTextFields(doc, read(MILK, "e2", { storedState: garbage }), quiet)).not.toBe(
      "adopted",
    );
    expect(readTextFields(doc)).toEqual(MILK);
  });

  it("keeps a peer's unsaved character and does not ask", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    peer.getText(TEXT_FIELDS_BODY).insert(8, "!");
    syncBoth(doc, peer);
    expect(rereadTextFields(doc, read(OAT, "e2"), quiet)).toBe("replaced");
    const body = readTextFields(doc).description;
    expect(body.split("!").length - 1).toBe(1);
    expect(body.replace("!", "")).toBe(OAT.description);
  });

  it("keeps a peer's character across two passes, also after adopting a save that lacks it", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    const saver = copyOf(doc);
    peer.getText(TEXT_FIELDS_BODY).insert(8, "!");
    syncBoth(doc, peer);
    saver.getText(TEXT_FIELDS_TITLE).insert(9, "!");
    const saved = { title: "Groceries!", description: MILK.description };
    expect(rereadTextFields(doc, read(saved, "e2", { storedState: stateOf(saver) }), quiet)).toBe(
      "adopted",
    );
    rereadTextFields(doc, read(OAT, "e3", { externalWrite: true }), quiet);
    rereadTextFields(doc, read(SOY, "e4", { externalWrite: true }), quiet);
    const body = readTextFields(doc).description;
    expect(body.split("!").length - 1).toBe(1);
    expect(body.replace("!", "")).toBe(SOY.description);
  });

  it("gives o2 once after two outside edits, also when o1 came over the mesh", () => {
    const a = seeded();
    const b = copyOf(a);
    rereadTextFields(a, read(OAT, "e2"), quiet);
    syncBoth(a, b);
    expect(rereadTextFields(b, read(SOY, "e3"), quiet)).toBe("replaced");
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(SOY);
    expect(readTextFields(b)).toEqual(SOY);
  });

  it("goes back to an earlier text, not blank", () => {
    const doc = seeded();
    rereadTextFields(doc, read(OAT, "e2"), quiet);
    rereadTextFields(doc, read(MILK, "e3"), quiet);
    expect(readTextFields(doc)).toEqual(MILK);
  });

  it("records base.vector as the delete limit plus the seed on two peers with different documents", () => {
    const a = seeded();
    const b = copyOf(a);
    b.getText(TEXT_FIELDS_BODY).insert(0, "> ");
    rereadTextFields(a, read(OAT, "e2"), quiet);
    rereadTextFields(b, read(OAT, "e2"), { pendingLocalWork: false });
    const seed = String(readTextFieldsSeed(a));
    expect(readTextFieldsBase(a)?.vector[seed]).toBeGreaterThan(0);
    expect(readTextFieldsBase(a)?.vector).toEqual(readTextFieldsBase(b)?.vector);
  });

  it("ends overlapping replacements on one text, and a following re-read on the server's", () => {
    const a = seeded();
    const b = copyOf(a);
    rereadTextFields(a, read(OAT, "e2"), quiet);
    rereadTextFields(b, read(SOY, "e3"), quiet);
    syncBoth(a, b);
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(readTextFields(b));
    rereadTextFields(a, read(SOY, "e3"), quiet);
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(SOY);
    expect(readTextFields(b)).toEqual(SOY);
  });
});

describe("text-fields re-read, case 4: own unsaved work", () => {
  it("asks and changes nothing", () => {
    const doc = seeded();
    doc.getText(TEXT_FIELDS_BODY).insert(8, "!");
    const before = Y.encodeStateVector(doc);
    expect(rereadTextFields(doc, read(OAT, "e2"), { pendingLocalWork: true })).toBe("prompt");
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it("'use the other version' removes only this client's own typing", () => {
    const doc = seeded();
    const peer = copyOf(doc);
    peer.getText(TEXT_FIELDS_BODY).insert(0, "P");
    syncBoth(doc, peer);
    doc.getText(TEXT_FIELDS_BODY).insert(0, "M");
    replaceTextFields(doc, OAT, {
      contentTag: '"e2-tag"',
      objectEtag: "e2",
      storedState: null,
      dropOwnWork: true,
    });
    const body = readTextFields(doc).description;
    expect(body).not.toContain("M");
    expect(body).toContain("P");
  });
});

describe("text-fields stale writers", () => {
  it("applies a stale snapshot after a peer's replacement and stays on the replacement", () => {
    const doc = seeded();
    const s1 = stateOf(doc);
    const peer = copyOf(doc);
    rereadTextFields(peer, read(OAT, "e2"), quiet);
    syncBoth(doc, peer);
    Y.applyUpdate(doc, s1, SERVER_ORIGIN);
    expect(readTextFields(doc)).toEqual(OAT);
  });
});

describe("rereadTextFields: typing a peer already saved", () => {
  it("is not unsaved work: an outside write replaces it quietly", () => {
    const typist = seeded();
    const peer = copyOf(typist);
    typist.getText(TEXT_FIELDS_BODY).insert(8, "!");
    syncBoth(typist, peer);

    // The peer saved everything, the typing included; then an outside writer changed the text.
    const result = rereadTextFields(
      typist,
      read(SOY, "o3", { storedState: stateOf(peer), externalWrite: true }),
      { pendingLocalWork: true },
    );

    expect(result).toBe("replaced");
    expect(readTextFields(typist)).toEqual(SOY);
  });

  it("still asks when this client typed something the stored state lacks", () => {
    const typist = seeded();
    const peer = copyOf(typist);
    typist.getText(TEXT_FIELDS_BODY).insert(8, "!");

    const result = rereadTextFields(
      typist,
      read(SOY, "o3", { storedState: stateOf(peer), externalWrite: true }),
      { pendingLocalWork: true },
    );

    expect(result).toBe("prompt");
  });
});
