import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  BINARY_FRAME_BYTES,
  decodeDataChannelMessage,
  encodeBinaryFrames,
  encodeDataChannelMessage,
  FrameReassembler,
  ingestDataChannelData,
  MAX_MESSAGE_FRAMES,
  MAX_PENDING_BYTES_PER_REMOTE,
  MAX_PENDING_MESSAGES_PER_REMOTE,
  PENDING_MESSAGE_TTL_MS,
} from "@/lib/rtc/session/data-channel-frames";
import {
  bytesFromBase64,
  bytesToBase64,
  decodeYjsHttpPayload,
  diffForStateVector,
  encodeYjsHttpPayload,
  splitYjsUpdate,
  YJS_HTTP_MAX_ENCODED_BYTES,
  yjsHttpEncodedSize,
} from "./docs-collab-http-wire";
import { encodeSyncStep1, encodeUpdateBroadcast, handleSyncMessage } from "./docs-collab-mesh-sync";

type TransportCodec = {
  name: string;
  roundTrip(bytes: Uint8Array): Uint8Array;
  deliver(update: Uint8Array, target: Y.Doc): void;
};

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const current = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = current;
  }
  return copy;
}

function pseudoRandom(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    out[index] = state & 0xff;
  }
  return out;
}

function dataChannelRoundTrip(bytes: Uint8Array): Uint8Array {
  const message = encodeDataChannelMessage(JSON.stringify({ bin: 1 }), bytes);
  const frames = encodeBinaryFrames(message, 7);
  for (const frame of frames) {
    expect(frame.byteLength).toBeLessThanOrEqual(BINARY_FRAME_BYTES);
  }
  const reassembler = new FrameReassembler();
  let merged: Uint8Array | null = null;
  for (const frame of shuffle(frames, 0x51)) {
    const done = reassembler.push("peer", frame);
    if (done) merged = done;
  }
  expect(merged).not.toBeNull();
  const decoded = decodeDataChannelMessage(merged!);
  expect(decoded?.payload).toEqual(bytes);
  return decoded!.payload!;
}

function httpRoundTrip(bytes: Uint8Array): Uint8Array {
  const decoded = bytesFromBase64(bytesToBase64(bytes));
  expect(decoded).toEqual(bytes);
  return decoded!;
}

const codecs: TransportCodec[] = [
  {
    name: "data-channel",
    roundTrip: dataChannelRoundTrip,
    deliver(update, target) {
      handleSyncMessage(dataChannelRoundTrip(encodeUpdateBroadcast(update)), target);
    },
  },
  {
    name: "http",
    roundTrip: httpRoundTrip,
    deliver(update, target) {
      const pieces = splitYjsUpdate(update);
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect(yjsHttpEncodedSize(piece)).toBeLessThanOrEqual(YJS_HTTP_MAX_ENCODED_BYTES);
        const decoded = decodeYjsHttpPayload(encodeYjsHttpPayload(piece, 1));
        expect(decoded).not.toBeNull();
        Y.applyUpdate(target, decoded!.bytes);
      }
    },
  },
];

/** Step 1 / step 2 on the data channel. HTTP carries the same diff as a state vector. */
function exchange(codec: TransportCodec, source: Y.Doc, target: Y.Doc): void {
  if (codec.name === "data-channel") {
    const reply = handleSyncMessage(codec.roundTrip(encodeSyncStep1(target)), source);
    if (reply) handleSyncMessage(codec.roundTrip(reply.u), target);
    return;
  }
  const diff = diffForStateVector(source, codec.roundTrip(Y.encodeStateVector(target)));
  if (diff.byteLength > 2) codec.deliver(diff, target);
}

function expectSameState(left: Y.Doc, right: Y.Doc): void {
  expect(Y.encodeStateAsUpdate(left)).toEqual(Y.encodeStateAsUpdate(right));
}

function fillSheet(doc: Y.Doc): void {
  const rows = doc.getMap("rows");
  for (let row = 0; row < 1200; row += 1) {
    const cells = new Y.Map<string>();
    for (let col = 0; col < 8; col += 1) {
      cells.set(String.fromCharCode(65 + col), `row ${row} column ${col} shared spreadsheet cell`);
    }
    rows.set(String(row), cells);
  }
}

describe("collab transport conformance", () => {
  it("keeps the frame bounds from #1261", () => {
    expect(PENDING_MESSAGE_TTL_MS).toBe(30_000);
    expect(MAX_PENDING_MESSAGES_PER_REMOTE).toBe(4);
    expect(MAX_MESSAGE_FRAMES).toBe(4096);
    expect(MAX_PENDING_BYTES_PER_REMOTE).toBe(16 * 1024 * 1024);
  });

  it("rejects a header length that falls outside the buffer", () => {
    const inside = encodeDataChannelMessage(JSON.stringify({ type: "poke" }));
    expect(decodeDataChannelMessage(inside)?.payload).toBeNull();
    const overflow = new Uint8Array(inside.byteLength);
    overflow.set(inside);
    const view = new DataView(overflow.buffer);
    view.setUint16(0, inside.byteLength);
    expect(decodeDataChannelMessage(overflow)).toBeNull();
  });

  it("treats a channel string as no message", () => {
    const reassembler = new FrameReassembler();
    expect(ingestDataChannelData(reassembler, "peer", JSON.stringify({ type: "poke" }))).toBeNull();
  });

  it("keeps a missing payload distinct from an empty one", () => {
    const absent = decodeDataChannelMessage(
      encodeDataChannelMessage(JSON.stringify({ t: "poke" })),
    );
    expect(absent?.payload).toBeNull();
    const empty = decodeDataChannelMessage(
      encodeDataChannelMessage(JSON.stringify({ type: "sync", bin: 1 }), new Uint8Array(0)),
    );
    expect(empty?.payload).toEqual(new Uint8Array(0));
    expect(empty?.payload).not.toBeNull();
  });

  describe("part A codec", () => {
    const cases: Array<{ name: string; bytes: Uint8Array }> = [
      { name: "0 bytes", bytes: new Uint8Array(0) },
      { name: "1 byte", bytes: Uint8Array.of(0x7f) },
      { name: "all 256 byte values", bytes: Uint8Array.from({ length: 256 }, (_, index) => index) },
      {
        name: "invalid utf-8",
        bytes: Uint8Array.of(0x80, 0xbf, 0xff, 0xc3, 0x28, 0xe2, 0x82, 0xf0, 0x80),
      },
      { name: "pseudo-random", bytes: pseudoRandom(500 * 1024, 0x1303) },
    ];

    it.each(cases)("round-trips $name on every transport", ({ bytes }) => {
      for (const codec of codecs) {
        expect(codec.roundTrip(bytes)).toEqual(bytes);
      }
    });
  });

  describe("part B yjs updates", () => {
    it.each(codecs)("syncs an empty document over $name", (codec) => {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      exchange(codec, docA, docB);
      expectSameState(docA, docB);
    });

    it.each(codecs)("syncs a small text edit over $name", (codec) => {
      const docA = new Y.Doc();
      docA.getText("body").insert(0, "hello from the editor");
      const docB = new Y.Doc();
      exchange(codec, docA, docB);
      expectSameState(docA, docB);
      expect(docB.getText("body").toString()).toBe("hello from the editor");
    });

    it.each(codecs)("syncs a 1200-row sheet over $name", (codec) => {
      const docA = new Y.Doc();
      fillSheet(docA);
      const state = Y.encodeStateAsUpdate(docA);
      expect(state.byteLength).toBeGreaterThan(400_000);
      const docB = new Y.Doc();
      exchange(codec, docA, docB);
      expectSameState(docA, docB);
    });
  });

  it("gives a late joiner the full state after earlier peers have edited", () => {
    const codec = codecs[0]!;
    const docA = new Y.Doc();
    docA.getText("body").insert(0, "first draft");
    const docB = new Y.Doc();
    exchange(codec, docA, docB);
    docA.getText("body").insert(docA.getText("body").length, " plus a second edit");
    codec.deliver(Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)), docB);
    const docC = new Y.Doc();
    exchange(codec, docA, docC);
    expectSameState(docA, docB);
    expectSameState(docA, docC);
    expect(docC.getText("body").toString()).toBe("first draft plus a second edit");
  });
});
