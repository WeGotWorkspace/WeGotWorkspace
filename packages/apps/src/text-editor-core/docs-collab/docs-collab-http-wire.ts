import * as encoding from "lib0/encoding";
import * as Y from "yjs";

/**
 * Encoded JSON payload cap from contract C4. Larger updates are split.
 * 63 KiB stays under the server's 64 KiB check when a base64 `/` is escaped.
 */
export const YJS_HTTP_MAX_ENCODED_BYTES = 63 * 1024;

export const YJS_HTTP_BATCH_MS = 300;

export const YJS_HTTP_FALLBACK_AFTER_MS = 5_000;

export const YJS_HTTP_RELAY_AFTER_MS = 8_000;

export const YJS_HTTP_RESYNC_MS = 30_000;

/** Steady poll while any peer is on the HTTP path. */
export const YJS_HTTP_POLL_MS = 1_000;

export type YjsHttpPayload = { u: string; n: number };

type WritableStruct = {
  id: { client: number; clock: number };
  length: number;
  write: (encoder: Y.UpdateEncoderV1, offset: number) => void;
  content?: { str?: string };
};

type DeleteSetItem = { clock: number; len: number };

/** Yjs does not export `DeleteSet` from the package entry. */
type DecodedDeleteSet = { clients: Map<number, DeleteSetItem[]> };

type DecodedUpdate = {
  structs: WritableStruct[];
  ds: DecodedDeleteSet;
};

type Fragment = {
  struct: WritableStruct;
  offset: number;
  end: number;
  /** Byte length of this fragment encoded on its own, including its update frame. */
  wireBytes: number;
};

/** Lone-update framing subtracted so fragment bodies can be summed. */
const LONE_FRAGMENT_FRAME_BYTES = 16;

/** Restored once per client after fragment costs drop the shared frame. */
const CLIENT_HEADER_ALLOWANCE = 24;

/** `{"u":"<base64>","n":N}` outside the base64 body. Base64 itself is 4/3. */
const JSON_WRAPPER_BYTES = 16;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bytesFromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function encodeYjsHttpPayload(bytes: Uint8Array, seq: number): YjsHttpPayload {
  return { u: bytesToBase64(bytes), n: seq };
}

export function decodeYjsHttpPayload(payload: unknown): { bytes: Uint8Array; seq: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const { u, n } = payload as { u?: unknown; n?: unknown };
  if (typeof u !== "string" || u === "" || typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    return null;
  }
  const bytes = bytesFromBase64(u);
  if (!bytes) return null;
  return { bytes, seq: n };
}

export function yjsHttpEncodedSize(update: Uint8Array, seq = 1): number {
  return JSON.stringify(encodeYjsHttpPayload(update, seq)).length;
}

/**
 * Split one Yjs update into pieces that each fit the mailbox cap. Each piece
 * is a valid update, so the receiver applies it on arrival. Item ids are kept,
 * which is what makes a duplicate from the data channel a no-op.
 */
export function splitYjsUpdate(
  update: Uint8Array,
  maxEncodedBytes = YJS_HTTP_MAX_ENCODED_BYTES,
): Uint8Array[] {
  if (yjsHttpEncodedSize(update) <= maxEncodedBytes) return [update];
  const decoded = Y.decodeUpdate(update) as unknown as DecodedUpdate;
  const fragments: Fragment[] = [];
  for (const struct of decoded.structs) {
    fragments.push(...fragmentStruct(struct, maxEncodedBytes));
  }
  if (fragments.length === 0) return [update];

  const pieces: Uint8Array[] = [];
  let batch: Fragment[] = [];
  let cost = 0;
  const clients = new Set<number>();

  const flush = (withDeletes: boolean) => {
    if (batch.length === 0) return;
    const flushing = batch;
    batch = [];
    cost = 0;
    clients.clear();
    emitWithinCap(flushing, withDeletes ? decoded.ds : emptyDeleteSet(), pieces, maxEncodedBytes);
  };

  for (const fragment of fragments) {
    const fragmentCost = Math.max(1, fragment.wireBytes - LONE_FRAGMENT_FRAME_BYTES);
    const client = fragment.struct.id.client;
    if (batch.length > 0) {
      const nextClients = clients.has(client) ? clients.size : clients.size + 1;
      const estimated = estimateMailboxBytes(
        cost + fragmentCost + nextClients * CLIENT_HEADER_ALLOWANCE,
      );
      if (estimated > maxEncodedBytes) flush(false);
    }
    batch.push(fragment);
    cost += fragmentCost;
    clients.add(client);
  }
  flush(true);
  return pieces.length > 0 ? pieces : [update];
}

/** Diff against a peer's state vector. Never a proactive full-state push. */
export function diffForStateVector(doc: Y.Doc, stateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, stateVector);
}

function emptyDeleteSet(): DecodedDeleteSet {
  return { clients: new Map() };
}

function fragmentStruct(struct: WritableStruct, maxEncodedBytes: number): Fragment[] {
  const whole = encodeFragments(
    [{ struct, offset: 0, end: struct.length, wireBytes: 0 }],
    emptyDeleteSet(),
  );
  if (yjsHttpEncodedSize(whole) <= maxEncodedBytes || !isStringStruct(struct)) {
    return [{ struct, offset: 0, end: struct.length, wireBytes: whole.byteLength }];
  }
  const pieces: Fragment[] = [];
  let offset = 0;
  while (offset < struct.length) {
    let size = 1;
    let next = Math.min(struct.length, offset + size);
    let nextBytes = 0;
    while (next < struct.length) {
      // Double the piece length. Doubling the absolute index collapses a long string to 1-char pieces.
      const candidate = Math.min(struct.length, offset + size * 2);
      if (candidate <= next) break;
      const encoded = encodeFragments(
        [{ struct, offset, end: candidate, wireBytes: 0 }],
        emptyDeleteSet(),
      );
      if (yjsHttpEncodedSize(encoded) > maxEncodedBytes) break;
      next = candidate;
      size = candidate - offset;
      nextBytes = encoded.byteLength;
    }
    if (nextBytes === 0) {
      nextBytes = encodeFragments(
        [{ struct, offset, end: next, wireBytes: 0 }],
        emptyDeleteSet(),
      ).byteLength;
    }
    pieces.push({ struct, offset, end: next, wireBytes: nextBytes });
    offset = next;
  }
  return pieces;
}

/** Plain base64 grows by 4/3. Flush before the JSON mailbox payload would pass the cap. */
function estimateMailboxBytes(yjsBytes: number): number {
  return Math.ceil(yjsBytes / 3) * 4 + JSON_WRAPPER_BYTES;
}

function emitWithinCap(
  fragments: Fragment[],
  ds: DecodedDeleteSet,
  pieces: Uint8Array[],
  maxEncodedBytes: number,
): void {
  if (fragments.length === 0) return;
  const encoded = encodeFragments(fragments, ds);
  if (yjsHttpEncodedSize(encoded) <= maxEncodedBytes || fragments.length < 2) {
    pieces.push(encoded);
    return;
  }
  const mid = Math.floor(fragments.length / 2);
  emitWithinCap(fragments.slice(0, mid), emptyDeleteSet(), pieces, maxEncodedBytes);
  emitWithinCap(fragments.slice(mid), ds, pieces, maxEncodedBytes);
}

function isStringStruct(struct: WritableStruct): boolean {
  return typeof struct.content?.str === "string";
}

function encodeFragments(fragments: Fragment[], ds: DecodedDeleteSet): Uint8Array {
  const byClient = new Map<number, Fragment[]>();
  for (const fragment of fragments) {
    const client = fragment.struct.id.client;
    const list = byClient.get(client) ?? [];
    list.push(fragment);
    byClient.set(client, list);
  }
  const encoder = new Y.UpdateEncoderV1();
  encoding.writeVarUint(encoder.restEncoder, byClient.size);
  const clients = [...byClient.keys()].sort((left, right) => right - left);
  for (const client of clients) {
    const list = byClient.get(client) ?? [];
    encoding.writeVarUint(encoder.restEncoder, list.length);
    encoder.writeClient(client);
    const first = list[0];
    if (!first) continue;
    encoding.writeVarUint(encoder.restEncoder, first.struct.id.clock + first.offset);
    for (const fragment of list) writeFragment(encoder, fragment);
  }
  writeDeleteSet(encoder, ds);
  return encoder.toUint8Array();
}

function writeFragment(encoder: Y.UpdateEncoderV1, fragment: Fragment): void {
  const content = fragment.struct.content;
  const saved = typeof content?.str === "string" ? content.str : null;
  if (saved !== null && content) content.str = saved.slice(0, fragment.end);
  try {
    fragment.struct.write(encoder, fragment.offset);
  } finally {
    if (saved !== null && content) content.str = saved;
  }
}

function writeDeleteSet(encoder: Y.UpdateEncoderV1, ds: DecodedDeleteSet): void {
  const entries = [...ds.clients.entries()].sort((left, right) => right[0] - left[0]);
  encoding.writeVarUint(encoder.restEncoder, entries.length);
  for (const [client, items] of entries) {
    encoder.resetDsCurVal();
    encoding.writeVarUint(encoder.restEncoder, client);
    encoding.writeVarUint(encoder.restEncoder, items.length);
    for (const item of items) {
      encoder.writeDsClock(item.clock);
      encoder.writeDsLen(item.len);
    }
  }
}
