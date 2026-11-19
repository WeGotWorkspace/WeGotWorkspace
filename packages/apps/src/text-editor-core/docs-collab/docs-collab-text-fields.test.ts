import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  EXTERNAL_REPLACE_ORIGIN,
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_META,
  TEXT_FIELDS_SEEDS,
  TEXT_FIELDS_TITLE,
  isTextFieldsEmpty,
  observeTextFieldsSeeds,
  readTextFields,
  readTextFieldsBase,
  readTextFieldsSeed,
  replaceTextFields,
  seedTextFields,
  textFieldsContentTag,
  textFieldsMetaToken,
  writeTextFieldsBaseIfUnchanged,
} from "./docs-collab-text-fields";

const MILK = { title: "Groceries", description: "Buy milk" };
const OAT = { title: "Groceries", description: "Buy oat milk" };
const SOY = { title: "Groceries", description: "Buy soy milk" };

function seeded(text = MILK): Y.Doc {
  const doc = new Y.Doc();
  seedTextFields(doc, text, '"tag-1"');
  observeTextFieldsSeeds(doc);
  return doc;
}

function syncBoth(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), "mesh");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), "mesh");
}

function copyOf(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc), "mesh");
  observeTextFieldsSeeds(copy);
  return copy;
}

function replace(
  doc: Y.Doc,
  text: typeof MILK,
  objectEtag: string,
  storedState: Uint8Array | null = null,
) {
  replaceTextFields(doc, text, { contentTag: `"${objectEtag}-tag"`, objectEtag, storedState });
}

function typeInBody(doc: Y.Doc, at: number, text: string): void {
  doc.getText(TEXT_FIELDS_BODY).insert(at, text);
}

describe("text-fields seed", () => {
  it("gives byte-identical updates for the same text on two clients", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedTextFields(a, MILK, '"tag-1"');
    seedTextFields(b, MILK, '"tag-1"');
    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));
  });

  it("is empty with neither field, and reading creates no shared type", () => {
    const doc = new Y.Doc();
    expect(isTextFieldsEmpty(doc)).toBe(true);
    expect(readTextFields(doc)).toEqual({ title: "", description: "" });
    expect([...doc.share.keys()]).toEqual([]);
    seedTextFields(doc, MILK, null);
    expect(isTextFieldsEmpty(doc)).toBe(false);
    expect(doc.share.has("default")).toBe(false);
  });

  it("records base and seed inside the first seed", () => {
    const doc = seeded();
    expect(readTextFieldsBase(doc)).toMatchObject({ contentTag: '"tag-1"', ...MILK });
    expect(readTextFieldsSeed(doc)).not.toBeNull();
  });

  it("seeds outside text with \\r\\n as \\n", () => {
    const doc = new Y.Doc();
    seedTextFields(doc, { title: "T", description: "one\r\ntwo" }, null);
    expect(readTextFields(doc).description).toBe("one\ntwo");
  });
});

describe("text-fields replacement", () => {
  it("replaces the text once", () => {
    const doc = seeded();
    replace(doc, OAT, "e2");
    expect(readTextFields(doc)).toEqual(OAT);
    expect(readTextFieldsBase(doc)).toMatchObject({ contentTag: '"e2-tag"', ...OAT });
  });

  it("gives o2 once after two outside edits, also on a document that got o1 over the mesh", () => {
    const a = seeded();
    const b = copyOf(a);
    replace(a, OAT, "e2");
    syncBoth(a, b);
    replace(b, SOY, "e3");
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(SOY);
    expect(readTextFields(b)).toEqual(SOY);
  });

  it("goes back to an earlier text without leaving it blank, on two documents", () => {
    const a = seeded();
    const b = copyOf(a);
    for (const doc of [a, b]) {
      replace(doc, OAT, "e2");
      replace(doc, MILK, "e3");
    }
    expect(readTextFields(a)).toEqual(MILK);
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(MILK);
    expect(readTextFields(b)).toEqual(MILK);
  });

  it("keeps a peer's unsaved character, once, across two replacements", () => {
    const a = seeded();
    const peer = copyOf(a);
    typeInBody(peer, 8, "!");
    syncBoth(a, peer);
    replace(a, OAT, "e2");
    replace(a, SOY, "e3");
    const body = readTextFields(a).description;
    expect(body.split("!").length - 1).toBe(1);
    expect(body.replace("!", "")).toBe(SOY.description);
  });

  it("keeps a character this client typed after base", () => {
    const doc = seeded();
    typeInBody(doc, 8, "?");
    replace(doc, OAT, "e2");
    expect(readTextFields(doc).description.split("?").length - 1).toBe(1);
  });

  it("removes this client's own typing with dropOwnWork, never a peer's", () => {
    const a = seeded();
    const peer = copyOf(a);
    typeInBody(peer, 0, "P");
    syncBoth(a, peer);
    typeInBody(a, 0, "M");
    replaceTextFields(a, OAT, {
      contentTag: null,
      objectEtag: "e2",
      storedState: null,
      dropOwnWork: true,
    });
    const body = readTextFields(a).description;
    expect(body).not.toContain("M");
    expect(body).toContain("P");
  });

  it("ends on one of two overlapping replacements, once, on both documents", () => {
    const a = seeded();
    const b = copyOf(a);
    replace(a, OAT, "e2");
    replace(b, SOY, "e3");
    syncBoth(a, b);
    syncBoth(a, b);
    expect(readTextFields(a)).toEqual(readTextFields(b));
    expect([OAT.description, SOY.description]).toContain(readTextFields(a).description);
    replace(a, SOY, "e4");
    syncBoth(a, b);
    expect(readTextFields(b)).toEqual(SOY);
  });

  it("ends on the new text in every client-id order", () => {
    const orders = new Set<string>();
    for (let n = 0; n < 12; n += 1) {
      const doc = seeded();
      const before = readTextFieldsSeed(doc) ?? 0;
      replace(doc, OAT, `x${n}`);
      const first = readTextFieldsSeed(doc) ?? 0;
      replace(doc, MILK, `y${n}`);
      const second = readTextFieldsSeed(doc) ?? 0;
      orders.add(`${first > before}-${second > first}`);
      expect(readTextFields(doc)).toEqual(MILK);
      expect(readTextFieldsBase(doc)?.contentTag).toBe(`"y${n}-tag"`);
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("applies the stored state first and deletes up to its vector", () => {
    const a = seeded();
    const writer = copyOf(a);
    typeInBody(writer, 8, " now");
    const stored = Y.encodeStateAsUpdate(writer);
    replace(a, SOY, "e2", stored);
    expect(readTextFields(a)).toEqual(SOY);
  });

  it("publishes with the replace origin", () => {
    const doc = seeded();
    const origins: unknown[] = [];
    doc.on("update", (_update, origin) => origins.push(origin));
    replace(doc, OAT, "e2");
    expect(origins.length).toBeGreaterThan(0);
    expect(origins.every((origin) => origin === EXTERNAL_REPLACE_ORIGIN)).toBe(true);
  });

  it("keeps one seed entry for the live seed after cleanup", () => {
    const doc = seeded();
    replace(doc, OAT, "e2");
    const seeds = [...doc.getMap(TEXT_FIELDS_SEEDS).keys()].map(Number);
    expect(seeds).toEqual([readTextFieldsSeed(doc)]);
    expect(doc.share.has(TEXT_FIELDS_TITLE)).toBe(true);
    expect(doc.share.has(TEXT_FIELDS_META)).toBe(true);
  });
});

describe("text-fields base", () => {
  it("is written by a landed save only when meta did not change since it was encoded", () => {
    const doc = seeded();
    const token = textFieldsMetaToken(doc);
    const base = { contentTag: '"saved"', ...OAT, vector: {} };
    replace(doc, SOY, "e2");
    expect(writeTextFieldsBaseIfUnchanged(doc, token, base)).toBe(false);
    expect(readTextFieldsBase(doc)?.contentTag).toBe('"e2-tag"');
    expect(writeTextFieldsBaseIfUnchanged(doc, textFieldsMetaToken(doc), base)).toBe(true);
    expect(readTextFieldsBase(doc)?.contentTag).toBe('"saved"');
  });

  it("computes the server's content tag", async () => {
    // sha1("Buy milk\0Groceries"), as CollabTextState::hashFields([description, title]).
    const tag = await textFieldsContentTag(MILK);
    expect(tag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(tag).toBe(await textFieldsContentTag({ ...MILK }));
  });
});
