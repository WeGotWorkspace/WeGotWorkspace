import type { PresenceEnvelope } from "@/presence-core/src/presence-types";

const MAX_CHAT_BODY_LENGTH = 4000;

export function serializePresenceEnvelope(envelope: PresenceEnvelope): string {
  return JSON.stringify(envelope);
}

/** Parse an inbound data-channel payload; unknown or malformed envelopes yield null. */
export function parsePresenceEnvelope(raw: string): PresenceEnvelope | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const envelope = data as Record<string, unknown>;
  if (envelope.v !== 1) return null;

  if (envelope.kind === "presence") {
    if (envelope.status !== "online" && envelope.status !== "away") return null;
    return { v: 1, kind: "presence", status: envelope.status };
  }

  if (envelope.kind === "chat") {
    if (typeof envelope.id !== "string" || envelope.id === "") return null;
    if (typeof envelope.body !== "string" || envelope.body.trim() === "") return null;
    if (typeof envelope.ts !== "number" || !Number.isFinite(envelope.ts)) return null;
    return {
      v: 1,
      kind: "chat",
      id: envelope.id,
      body: envelope.body.slice(0, MAX_CHAT_BODY_LENGTH),
      ts: envelope.ts,
    };
  }

  if (envelope.kind === "typing") {
    return { v: 1, kind: "typing" };
  }

  return null;
}
