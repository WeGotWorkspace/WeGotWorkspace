import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  decodeYjsHttpPayload,
  encodeYjsHttpPayload,
  splitYjsUpdate,
  yjsHttpEncodedSize,
  YJS_HTTP_MAX_ENCODED_BYTES,
} from "./docs-collab-http-wire";

/** PHP `json_encode` escapes `/` unless `JSON_UNESCAPED_SLASHES` is set. */
function phpEscapedJsonBytes(update: Uint8Array): number {
  const json = JSON.stringify(encodeYjsHttpPayload(update, 1));
  let slashes = 0;
  for (let index = 0; index < json.length; index += 1) {
    if (json.charCodeAt(index) === 47) slashes += 1;
  }
  return json.length + slashes;
}

function expectMailboxPieces(update: Uint8Array, pieces: Uint8Array[]): void {
  expect(pieces.length).toBeGreaterThan(1);
  // The old splitter emitted thousands of 1-character fragments. A linear split
  // stays within one piece per 16 KiB of update, plus a remainder.
  expect(pieces.length).toBeLessThanOrEqual(Math.ceil(update.length / 16_384) + 1);
  pieces.forEach((piece, index) => {
    const encoded = yjsHttpEncodedSize(piece);
    expect(encoded).toBeLessThanOrEqual(YJS_HTTP_MAX_ENCODED_BYTES);
    expect(encoded).toBeLessThanOrEqual(65_536);
    expect(phpEscapedJsonBytes(piece)).toBeLessThanOrEqual(65_536);
    if (index < pieces.length - 1) expect(piece.byteLength).toBeGreaterThanOrEqual(8_192);
  });
}

function paragraphDocument(count: number): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  doc.transact(() => {
    for (let index = 0; index < count; index += 1) {
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [
        new Y.XmlText(`Paragraph ${index} stands in for a real document block.`),
      ]);
      fragment.insert(fragment.length, [paragraph]);
    }
  });
  return doc;
}

describe("yjs http wire", () => {
  it("round-trips a payload and rejects a malformed one", () => {
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    const payload = encodeYjsHttpPayload(update, 3);
    expect(decodeYjsHttpPayload(payload)?.seq).toBe(3);
    expect(decodeYjsHttpPayload({ u: "@@@", n: 1 })).toBeNull();
    expect(decodeYjsHttpPayload({ u: payload.u, n: -1 })).toBeNull();
  });

  it("splits an oversized update into pieces that converge in any order", () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "a".repeat(80_000));
    const update = Y.encodeStateAsUpdate(doc);
    expect(yjsHttpEncodedSize(update)).toBeGreaterThan(YJS_HTTP_MAX_ENCODED_BYTES);
    const pieces = splitYjsUpdate(update);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(yjsHttpEncodedSize(piece)).toBeLessThanOrEqual(YJS_HTTP_MAX_ENCODED_BYTES);
    }

    const forward = new Y.Doc();
    for (const piece of pieces) Y.applyUpdate(forward, piece);
    const reverse = new Y.Doc();
    for (const piece of [...pieces].reverse()) Y.applyUpdate(reverse, piece);
    expect(forward.getText("t").toString()).toBe(doc.getText("t").toString());
    expect(reverse.getText("t").toString()).toBe(doc.getText("t").toString());
  });

  it("splits a 240,000-character block into bounded pieces", () => {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "a".repeat(240_000));
    const update = Y.encodeStateAsUpdate(doc);
    const started = performance.now();
    const pieces = splitYjsUpdate(update);
    const elapsed = performance.now() - started;
    expect(elapsed, `240k split took ${elapsed.toFixed(1)} ms`).toBeLessThan(5_000);
    expectMailboxPieces(update, pieces);

    const forward = new Y.Doc();
    for (const piece of pieces) Y.applyUpdate(forward, piece);
    expect(forward.getText("t").toString()).toBe(doc.getText("t").toString());
  });

  it("splits a 3,000-paragraph document into bounded pieces", () => {
    const doc = paragraphDocument(3_000);
    const update = Y.encodeStateAsUpdate(doc);
    const started = performance.now();
    const pieces = splitYjsUpdate(update);
    const elapsed = performance.now() - started;
    expect(elapsed, `3000-paragraph split took ${elapsed.toFixed(1)} ms`).toBeLessThan(5_000);
    expectMailboxPieces(update, pieces);

    const forward = new Y.Doc();
    for (const piece of pieces) Y.applyUpdate(forward, piece);
    expect(forward.getXmlFragment("default").toJSON()).toEqual(
      doc.getXmlFragment("default").toJSON(),
    );
  });
});
