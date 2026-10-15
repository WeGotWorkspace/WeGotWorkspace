/**
 * One framed body: a uint16 JSON header and an unsplit tail.
 * Callers read the header to know how the tail is divided.
 *
 * [uint16 headerLen, big-endian][UTF-8 JSON header][tail]
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeFramedPayload(
  header: object,
  parts: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const json = textEncoder.encode(JSON.stringify(header));
  if (json.byteLength > 0xffff) {
    throw new Error("framed header exceeds uint16");
  }
  let tailLength = 0;
  for (const part of parts) tailLength += part.byteLength;
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(2 + json.byteLength + tailLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, json.byteLength);
  out.set(json, 2);
  let offset = 2 + json.byteLength;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** The tail is returned whole. A bad frame is null. */
export function decodeFramedPayload(
  bytes: Uint8Array,
): { header: unknown; tail: Uint8Array } | null {
  if (bytes.byteLength < 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint16(0);
  if (headerLen > bytes.byteLength - 2) return null;
  let header: unknown;
  try {
    header = JSON.parse(textDecoder.decode(bytes.subarray(2, 2 + headerLen)));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  return { header, tail: bytes.subarray(2 + headerLen) };
}
