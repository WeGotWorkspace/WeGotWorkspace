import type { RtcPeerDescriptor } from "@/lib/rtc/types";

/** Compact Meet channel message on the presence mesh (no previews/reactions). */
export type PresenceChannelMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  parentId?: string | null;
};

/** Logical room token for the workspace-wide principal room (`p_workspace`). */
export const PRESENCE_WORKSPACE_ROOM = "workspace";

/** Logical room token for a group principal room (`p_groups.{slug}`). */
export function presenceGroupRoom(slug: string): string {
  return `groups.${slug}`;
}

export type PresenceUserStatus = "online" | "away";

export type PresenceCoworker = {
  /** Sabre username (authoritative identity from the signaling roster). */
  username: string;
  /** Display name from the roster. */
  name: string;
  status: PresenceUserStatus;
};

export type PresenceChatMessage = {
  id: string;
  fromUsername: string;
  fromName: string;
  body: string;
  ts: number;
  isSelf: boolean;
};

export type PresenceStatus = "idle" | "waiting" | "joining" | "online" | "error";

export type PresenceSnapshot = {
  /** `waiting` = lazy mode, join deferred until the tab becomes visible. */
  status: PresenceStatus;
  selfUsername: string | null;
  roster: PresenceCoworker[];
  chat: PresenceChatMessage[];
  typingUsernames: string[];
  /**
   * Chat-channel-scoped typing (chunk K): channel id -> sorted usernames
   * currently typing there. Ephemeral, expiry-pruned; self excluded.
   */
  channelTyping: Record<string, string[]>;
};

/**
 * Data-only payload envelope carried on the `presence` data channel.
 *
 * `typing` without `channel` is the workspace-wide indicator; with `channel`
 * it scopes to a Meet chat channel, and `stop: true` retracts it early
 * (send/blur/cleared composer) instead of waiting for the receiver TTL.
 *
 * Meet acceleration kinds (`channel-message`, `channel-message-patch`,
 * `channel-message-destroy`, `channel-reaction`, `channel-changed`,
 * `call-active`) are hints — server + JMAP/room-status poll stay
 * authoritative. Senders must `sendTo` members, never workspace-broadcast
 * those kinds. Apply lives in `meet-mesh-sot` (SST).
 */
export type PresenceEnvelope =
  | { v: 1; kind: "presence"; status: PresenceUserStatus }
  | { v: 1; kind: "chat"; id: string; body: string; ts: number }
  | { v: 1; kind: "typing"; channel?: string; stop?: boolean }
  | { v: 1; kind: "channel-message"; message: PresenceChannelMessage }
  | {
      v: 1;
      kind: "channel-message-patch";
      id: string;
      channel: string;
      body: string;
      editedAt: number;
    }
  | { v: 1; kind: "channel-message-destroy"; id: string; channel: string }
  | {
      v: 1;
      kind: "channel-reaction";
      messageId: string;
      channel: string;
      emoji: string;
      on: boolean;
    }
  | { v: 1; kind: "channel-changed"; channel: string }
  | { v: 1; kind: "call-active"; channel: string; active: boolean; audioOnly?: boolean };

/** Inbound Meet acceleration events (after sender-username checks). */
export type PresenceMeetFanoutEvent =
  | { kind: "channel-message"; senderUsername: string; message: PresenceChannelMessage }
  | {
      kind: "channel-message-patch";
      senderUsername: string;
      id: string;
      channel: string;
      body: string;
      editedAt: number;
    }
  | {
      kind: "channel-message-destroy";
      senderUsername: string;
      id: string;
      channel: string;
    }
  | {
      kind: "channel-reaction";
      senderUsername: string;
      messageId: string;
      channel: string;
      emoji: string;
      on: boolean;
    }
  | { kind: "channel-changed"; senderUsername: string; channel: string }
  | {
      kind: "call-active";
      senderUsername: string;
      channel: string;
      active: boolean;
      audioOnly?: boolean;
    };

export type PresenceMeshEvent =
  | { type: "roster" }
  | { type: "dc-open"; peerId: string }
  | { type: "envelope"; peerId: string; envelope: PresenceEnvelope };

/**
 * Transport port for the presence store. The live implementation wraps an
 * `RtcPeerMesh` (see `presence-rtc-session.ts`); tests inject a fake.
 */
export type PresenceMeshSession = {
  join(name: string): Promise<{ peerId: string }>;
  leave(): Promise<void>;
  broadcast(envelope: PresenceEnvelope): void;
  sendTo(peerId: string, envelope: PresenceEnvelope): void;
  getRoomPeers(): RtcPeerDescriptor[];
  onEvent(listener: (event: PresenceMeshEvent) => void): () => void;
};
