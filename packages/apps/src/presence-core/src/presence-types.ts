import type { RtcPeerDescriptor } from "@/lib/rtc/types";

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
};

/** Data-only payload envelope carried on the `presence` data channel. */
export type PresenceEnvelope =
  | { v: 1; kind: "presence"; status: PresenceUserStatus }
  | { v: 1; kind: "chat"; id: string; body: string; ts: number }
  | { v: 1; kind: "typing" };

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
