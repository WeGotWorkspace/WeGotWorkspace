/**
 * Binary data-channel frames for peers that advertise the `bin` capability.
 *
 * Each frame is a `Uint8Array` of at most 16 KiB:
 *   0..3  message id (uint32 big-endian)
 *   4..5  chunk index (uint16 big-endian, zero-based)
 *   6..7  chunk count (uint16 big-endian)
 *   8..   UTF-8 payload bytes
 *
 * Receivers still accept a single JSON string from peers that do not speak `bin`.
 */

export const BINARY_FRAME_BYTES = 16 * 1024;
export const BINARY_FRAME_HEADER_BYTES = 8;
export const DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES = 1024 * 1024;

const PAYLOAD_BYTES = BINARY_FRAME_BYTES - BINARY_FRAME_HEADER_BYTES;

export type DecodedBinaryFrame = {
  messageId: number;
  index: number;
  count: number;
  payload: Uint8Array;
};

export function peerAdvertisesBin(caps: readonly string[] | undefined): boolean {
  return Array.isArray(caps) && caps.includes("bin");
}

export function encodeBinaryFrames(payload: Uint8Array, messageId: number): Uint8Array[] {
  const count = Math.max(1, Math.ceil(payload.byteLength / PAYLOAD_BYTES));
  if (count > 0xffff) {
    throw new Error("data-channel message exceeds frame count");
  }
  const frames: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * PAYLOAD_BYTES;
    const slice = payload.subarray(start, Math.min(start + PAYLOAD_BYTES, payload.byteLength));
    const frame = new Uint8Array(BINARY_FRAME_HEADER_BYTES + slice.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint32(0, messageId >>> 0);
    view.setUint16(4, index);
    view.setUint16(6, count);
    frame.set(slice, BINARY_FRAME_HEADER_BYTES);
    frames.push(frame);
  }
  return frames;
}

export function decodeBinaryFrame(bytes: Uint8Array): DecodedBinaryFrame | null {
  if (bytes.byteLength < BINARY_FRAME_HEADER_BYTES || bytes.byteLength > BINARY_FRAME_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const messageId = view.getUint32(0);
  const index = view.getUint16(4);
  const count = view.getUint16(6);
  if (count === 0 || index >= count) return null;
  return {
    messageId,
    index,
    count,
    payload: bytes.subarray(BINARY_FRAME_HEADER_BYTES),
  };
}

/** Collects chunked frames for one remote until every index of a message is present. */
export class FrameReassembler {
  private readonly pending = new Map<string, { count: number; chunks: Map<number, Uint8Array> }>();

  push(remoteId: string, bytes: Uint8Array): string | null {
    const frame = decodeBinaryFrame(bytes);
    if (!frame) return null;
    const key = `${remoteId}:${frame.messageId}`;
    let entry = this.pending.get(key);
    if (!entry || entry.count !== frame.count) {
      entry = { count: frame.count, chunks: new Map() };
      this.pending.set(key, entry);
    }
    entry.chunks.set(frame.index, frame.payload);
    if (entry.chunks.size < entry.count) return null;
    let total = 0;
    for (let index = 0; index < entry.count; index += 1) {
      const part = entry.chunks.get(index);
      if (!part) return null;
      total += part.byteLength;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (let index = 0; index < entry.count; index += 1) {
      const part = entry.chunks.get(index);
      if (!part) return null;
      merged.set(part, offset);
      offset += part.byteLength;
    }
    this.pending.delete(key);
    return new TextDecoder().decode(merged);
  }

  dropRemote(remoteId: string): void {
    const prefix = `${remoteId}:`;
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }
}

function bytesFromChannelData(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

/**
 * Turn one data-channel event into a complete JSON string.
 * A string is legacy JSON. Binary frames return text only once every chunk arrives.
 */
export function ingestDataChannelData(
  reassembler: FrameReassembler,
  remoteId: string,
  data: unknown,
): string | null {
  if (typeof data === "string") return data;
  const bytes = bytesFromChannelData(data);
  if (!bytes) return null;
  return reassembler.push(remoteId, bytes);
}
