/**
 * Envelope multiplexed on the principal-room `presence` data channel so a
 * collab room can share an already-open SCTP association. Additional docs
 * reuse the same channel via the `room` field — no ICE/DTLS restart.
 */

export const COLLAB_REUSE_ENVELOPE_KIND = "collab-reuse" as const;

export type CollabReuseOp = "open" | "ack" | "close" | "data";

export type CollabReuseEnvelope = {
  v: 1;
  kind: typeof COLLAB_REUSE_ENVELOPE_KIND;
  room: string;
  op: CollabReuseOp;
  /** Sender's collab-room peer id (ephemeral, 16-hex). */
  collabPeerId?: string;
  /** Display name from the collab join, for roster overlay before the poll. */
  name?: string;
  /** Collab mesh payload when `op` is `data`. */
  payload?: unknown;
};

const OPS = new Set<CollabReuseOp>(["open", "ack", "close", "data"]);

export function serializeCollabReuseEnvelope(envelope: CollabReuseEnvelope): string {
  return JSON.stringify(envelope);
}

/** Parse an inbound principal-DC payload; unknown or malformed envelopes yield null. */
export function parseCollabReuseEnvelope(raw: string): CollabReuseEnvelope | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseCollabReuseEnvelopeValue(data);
}

export function parseCollabReuseEnvelopeValue(data: unknown): CollabReuseEnvelope | null {
  if (!data || typeof data !== "object") return null;
  const envelope = data as Record<string, unknown>;
  if (envelope.v !== 1) return null;
  if (envelope.kind !== COLLAB_REUSE_ENVELOPE_KIND) return null;
  if (typeof envelope.room !== "string" || envelope.room === "") return null;
  if (typeof envelope.op !== "string" || !OPS.has(envelope.op as CollabReuseOp)) return null;

  const parsed: CollabReuseEnvelope = {
    v: 1,
    kind: COLLAB_REUSE_ENVELOPE_KIND,
    room: envelope.room,
    op: envelope.op as CollabReuseOp,
  };
  if (typeof envelope.collabPeerId === "string" && envelope.collabPeerId !== "") {
    parsed.collabPeerId = envelope.collabPeerId;
  }
  if (typeof envelope.name === "string" && envelope.name !== "") {
    parsed.name = envelope.name;
  }
  if (envelope.op === "data") {
    if (envelope.payload === undefined) return null;
    parsed.payload = envelope.payload;
  }
  return parsed;
}
