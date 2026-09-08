import type { PresenceChannelMessage, PresenceEnvelope } from "@/presence-core/src/presence-types";

const MAX_CHAT_BODY_LENGTH = 4000;

function parseChannelMessage(value: unknown): PresenceChannelMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id === "") return null;
  if (typeof row.channelId !== "string" || row.channelId === "") return null;
  if (typeof row.authorId !== "string" || row.authorId === "") return null;
  if (typeof row.authorName !== "string") return null;
  if (typeof row.body !== "string" || row.body.trim() === "") return null;
  if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) return null;
  const parentId = row.parentId;
  if (parentId !== undefined && parentId !== null && typeof parentId !== "string") return null;
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body.slice(0, MAX_CHAT_BODY_LENGTH),
    createdAt: row.createdAt,
    parentId: typeof parentId === "string" ? parentId : null,
  };
}

export function serializePresenceEnvelope(envelope: PresenceEnvelope): string {
  return JSON.stringify(envelope);
}

/** Build a `call-active` hint. `audioOnly` is omitted unless it is true. */
export function presenceCallActiveEnvelope(
  channel: string,
  active: boolean,
  audioOnly?: boolean,
): Extract<PresenceEnvelope, { kind: "call-active" }> {
  return audioOnly === true
    ? { v: 1, kind: "call-active", channel, active, audioOnly: true }
    : { v: 1, kind: "call-active", channel, active };
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
    if (envelope.channel === undefined) return { v: 1, kind: "typing" };
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    return envelope.stop === true
      ? { v: 1, kind: "typing", channel: envelope.channel, stop: true }
      : { v: 1, kind: "typing", channel: envelope.channel };
  }

  if (envelope.kind === "channel-message") {
    const message = parseChannelMessage(envelope.message);
    if (!message) return null;
    return { v: 1, kind: "channel-message", message };
  }

  if (envelope.kind === "channel-message-patch") {
    if (typeof envelope.id !== "string" || envelope.id === "") return null;
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    if (typeof envelope.body !== "string" || envelope.body.trim() === "") return null;
    if (typeof envelope.editedAt !== "number" || !Number.isFinite(envelope.editedAt)) return null;
    return {
      v: 1,
      kind: "channel-message-patch",
      id: envelope.id,
      channel: envelope.channel,
      body: envelope.body.slice(0, MAX_CHAT_BODY_LENGTH),
      editedAt: envelope.editedAt,
    };
  }

  if (envelope.kind === "channel-message-destroy") {
    if (typeof envelope.id !== "string" || envelope.id === "") return null;
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    return { v: 1, kind: "channel-message-destroy", id: envelope.id, channel: envelope.channel };
  }

  if (envelope.kind === "channel-reaction") {
    if (typeof envelope.messageId !== "string" || envelope.messageId === "") return null;
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    if (typeof envelope.emoji !== "string" || envelope.emoji === "" || envelope.emoji.length > 32) {
      return null;
    }
    if (typeof envelope.on !== "boolean") return null;
    return {
      v: 1,
      kind: "channel-reaction",
      messageId: envelope.messageId,
      channel: envelope.channel,
      emoji: envelope.emoji,
      on: envelope.on,
    };
  }

  if (envelope.kind === "channel-changed") {
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    return { v: 1, kind: "channel-changed", channel: envelope.channel };
  }

  if (envelope.kind === "call-active") {
    if (typeof envelope.channel !== "string" || envelope.channel === "") return null;
    if (typeof envelope.active !== "boolean") return null;
    return presenceCallActiveEnvelope(
      envelope.channel,
      envelope.active,
      envelope.audioOnly === true,
    );
  }

  return null;
}
