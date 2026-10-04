import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  decodeYjsHttpPayload,
  encodeYjsHttpPayload,
  splitYjsUpdate,
  yjsHttpEncodedSize,
  YJS_HTTP_MAX_ENCODED_BYTES,
} from "./docs-collab-http-wire";

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
});
