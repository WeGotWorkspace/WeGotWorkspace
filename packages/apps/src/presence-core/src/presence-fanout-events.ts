import type {
  PresenceEnvelope,
  PresenceMeetFanoutEvent,
  PresenceCheckNowEvent,
} from "@/presence-core/src/presence-types";

/**
 * Translates an inbound presence envelope into the Meet acceleration event it
 * fans out, or null when the envelope is not a Meet hint. The sender username
 * comes from the signaling roster, never from the payload: a `channel-message`
 * whose `authorId` disagrees with the sender is dropped.
 */
export function toPresenceMeetFanoutEvent(
  envelope: PresenceEnvelope,
  senderUsername: string,
): PresenceMeetFanoutEvent | null {
  switch (envelope.kind) {
    case "channel-message":
      if (envelope.message.authorId !== senderUsername) return null;
      return { kind: "channel-message", senderUsername, message: envelope.message };
    case "channel-message-patch":
      return {
        kind: "channel-message-patch",
        senderUsername,
        id: envelope.id,
        channel: envelope.channel,
        body: envelope.body,
        editedAt: envelope.editedAt,
      };
    case "channel-message-destroy":
      return {
        kind: "channel-message-destroy",
        senderUsername,
        id: envelope.id,
        channel: envelope.channel,
      };
    case "channel-reaction":
      return {
        kind: "channel-reaction",
        senderUsername,
        messageId: envelope.messageId,
        channel: envelope.channel,
        emoji: envelope.emoji,
        on: envelope.on,
      };
    case "call-active":
      return {
        kind: "call-active",
        senderUsername,
        channel: envelope.channel,
        active: envelope.active,
        ...(envelope.audioOnly === true ? { audioOnly: true as const } : {}),
      };
    default:
      return null;
  }
}

/** A peer's `check-now`, or null for any other envelope kind. */
export function toPresenceCheckNowEvent(
  envelope: PresenceEnvelope,
  senderUsername: string,
): PresenceCheckNowEvent | null {
  return envelope.kind === "check-now" ? { kind: "check-now", senderUsername } : null;
}
