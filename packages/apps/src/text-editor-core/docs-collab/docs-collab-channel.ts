/** Set on a message that owns the raw tail of a data-channel frame. */
export const COLLAB_BINARY_FLAG = 1;

/**
 * Split a collab mesh message into the JSON header and the raw tail.
 * Messages without `u` stay a header and have no payload.
 */
export function collabChannelParts(message: unknown): { header: unknown; bytes?: Uint8Array } {
  if (!message || typeof message !== "object" || !("u" in message)) return { header: message };
  const record = message as Record<string, unknown>;
  if (!(record.u instanceof Uint8Array)) return { header: message };
  const header: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "u") header[key] = value;
  }
  header.bin = COLLAB_BINARY_FLAG;
  return { header, bytes: record.u };
}

/** Rebuild a collab message from a data-channel header and its tail. */
export function collabMessageFromChannel(
  json: string,
  payload: Uint8Array | null,
): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = { ...(data as Record<string, unknown>) };
  if (record.bin !== COLLAB_BINARY_FLAG) {
    if (payload && payload.byteLength > 0) return null;
    return record;
  }
  delete record.bin;
  record.u = payload ?? new Uint8Array(0);
  return record;
}
