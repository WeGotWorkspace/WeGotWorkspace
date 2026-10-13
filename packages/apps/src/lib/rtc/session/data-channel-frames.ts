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

/** Drop an incomplete message that is still open after 30 seconds. */
export const PENDING_MESSAGE_TTL_MS = 30_000;
/** Several messages in flight is normal. A fifth drops the oldest. */
export const MAX_PENDING_MESSAGES_PER_REMOTE = 4;
/**
 * Sanity ceiling for one message, on both encode and decode.
 * 4096 frames is about 64 MiB on the wire, above real Yjs JSON traffic.
 */
export const MAX_MESSAGE_FRAMES = 4_096;
/**
 * Cap on incomplete payload from the other messages of one remote.
 * The message that owns the frame just received is spared, so one
 * legitimate message can always be finished.
 */
export const MAX_PENDING_BYTES_PER_REMOTE = 16 * 1024 * 1024;

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
  if (count > MAX_MESSAGE_FRAMES) {
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
  if (count === 0 || index >= count || count > MAX_MESSAGE_FRAMES) return null;
  return {
    messageId,
    index,
    count,
    payload: bytes.subarray(BINARY_FRAME_HEADER_BYTES),
  };
}

type PendingMessage = {
  count: number;
  chunks: Map<number, Uint8Array>;
  createdAtMs: number;
  bytes: number;
};

/**
 * Collects chunked frames for one remote until every index of a message is present.
 * Expired and excess incomplete messages are dropped on `push`. There is no timer.
 */
export class FrameReassembler {
  private readonly pending = new Map<string, Map<number, PendingMessage>>();

  constructor(private readonly now: () => number = Date.now) {}

  push(remoteId: string, bytes: Uint8Array): string | null {
    const frame = decodeBinaryFrame(bytes);
    if (!frame) return null;
    this.evictExpired(remoteId);
    const messages = this.messagesFor(remoteId);
    const entry = this.entryFor(messages, frame.messageId, frame.count);
    this.storeChunk(entry, frame.index, frame.payload);
    if (entry.chunks.size >= entry.count) {
      const merged = this.merge(entry);
      messages.delete(frame.messageId);
      this.forgetIfEmpty(remoteId);
      return merged ? new TextDecoder().decode(merged) : null;
    }
    this.enforceByteBudget(remoteId, frame.messageId);
    return null;
  }

  dropRemote(remoteId: string): void {
    this.pending.delete(remoteId);
  }

  private messagesFor(remoteId: string): Map<number, PendingMessage> {
    let messages = this.pending.get(remoteId);
    if (!messages) {
      messages = new Map();
      this.pending.set(remoteId, messages);
    }
    return messages;
  }

  private entryFor(
    messages: Map<number, PendingMessage>,
    messageId: number,
    count: number,
  ): PendingMessage {
    const existing = messages.get(messageId);
    if (existing && existing.count === count) return existing;
    if (!existing) this.dropOldestIfFull(messages);
    const entry: PendingMessage = {
      count,
      chunks: new Map(),
      createdAtMs: this.now(),
      bytes: 0,
    };
    messages.set(messageId, entry);
    return entry;
  }

  private storeChunk(entry: PendingMessage, index: number, payload: Uint8Array): void {
    const previous = entry.chunks.get(index);
    if (previous) entry.bytes -= previous.byteLength;
    entry.chunks.set(index, payload);
    entry.bytes += payload.byteLength;
  }

  private merge(entry: PendingMessage): Uint8Array | null {
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
    return merged;
  }

  private evictExpired(remoteId: string): void {
    const messages = this.pending.get(remoteId);
    if (!messages) return;
    const now = this.now();
    for (const [messageId, entry] of messages) {
      if (now - entry.createdAtMs > PENDING_MESSAGE_TTL_MS) messages.delete(messageId);
    }
    this.forgetIfEmpty(remoteId);
  }

  private dropOldestIfFull(messages: Map<number, PendingMessage>): void {
    if (messages.size < MAX_PENDING_MESSAGES_PER_REMOTE) return;
    const oldest = this.oldestId(messages);
    if (oldest !== undefined) messages.delete(oldest);
  }

  // Ordered SCTP: frames of N+1 arrive only after N, so this keep id stays with the open message.
  private enforceByteBudget(remoteId: string, keepMessageId: number): void {
    const messages = this.pending.get(remoteId);
    if (!messages) return;
    while (this.totalBytes(messages, keepMessageId) > MAX_PENDING_BYTES_PER_REMOTE) {
      const oldest = this.oldestId(messages, keepMessageId);
      if (oldest === undefined) break;
      messages.delete(oldest);
    }
    this.forgetIfEmpty(remoteId);
  }

  private totalBytes(messages: Map<number, PendingMessage>, exceptId?: number): number {
    let total = 0;
    for (const [messageId, entry] of messages) {
      if (messageId === exceptId) continue;
      total += entry.bytes;
    }
    return total;
  }

  private oldestId(messages: Map<number, PendingMessage>, exceptId?: number): number | undefined {
    let oldestId: number | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [messageId, entry] of messages) {
      if (messageId === exceptId) continue;
      if (entry.createdAtMs < oldestAt) {
        oldestAt = entry.createdAtMs;
        oldestId = messageId;
      }
    }
    return oldestId;
  }

  private forgetIfEmpty(remoteId: string): void {
    const messages = this.pending.get(remoteId);
    if (messages && messages.size === 0) this.pending.delete(remoteId);
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
