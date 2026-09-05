import {
  meetDirectMessageChannelId,
  meetDirectMessagePrincipalId,
} from "@/meet-core/src/meet-direct-messages";

/**
 * Browser paths for live Meet chat. Type lives in the path; internal selection
 * keys stay `MeetChannel.id` (channels) and `dm:{peer}` (DMs). Server collection
 * ids (`chat-…`, `dm-{hash}`) are not renamed.
 *
 *   /meet/channels/$channelId  — 1:1 with MeetChannel.id (no extra `chat-` prefix)
 *   /meet/dms/$peerId          — directory principal, not `dm:{peer}` / `dm-{hash}`
 */
export const MEET_CHANNELS_ROUTE = "/meet/channels/$channelId" as const;
export const MEET_DMS_ROUTE = "/meet/dms/$peerId" as const;

/** Nested segments that must not be treated as a legacy `/meet/{id}` channel id. */
export const MEET_LEGACY_RESERVED_SEGMENTS = ["channels", "dms"] as const;

/** Server DM collection prefix (`dm-{hash}`) — not a virtual `dm:{peer}` UI id. */
const MEET_SERVER_DM_COLLECTION_PREFIX = "dm-";

export type MeetChatRouteParams = {
  channelId?: string;
  peerId?: string;
  /** Present only on the back-compat `/meet/{legacyId}` child. */
  legacyId?: string;
};

export type MeetChatNavigateTarget =
  | { to: typeof MEET_CHANNELS_ROUTE; params: { channelId: string } }
  | { to: typeof MEET_DMS_ROUTE; params: { peerId: string } };

export type MeetChatLegacyRedirect = MeetChatNavigateTarget | { to: "/meet" };

/** URL params → workspace selection key. */
export function meetSelectionFromRouteParams(params: MeetChatRouteParams): string | null {
  if (params.peerId) return meetDirectMessageChannelId(params.peerId);
  if (params.channelId) return params.channelId;
  if (params.legacyId) return meetSelectionFromLegacyRedirect(meetLegacyRedirect(params.legacyId));
  return null;
}

function meetSelectionFromLegacyRedirect(target: MeetChatLegacyRedirect): string | null {
  if (target.to === MEET_DMS_ROUTE) return meetDirectMessageChannelId(target.params.peerId);
  if (target.to === MEET_CHANNELS_ROUTE) return target.params.channelId;
  return null;
}

/** Workspace selection key → nested Meet path. */
export function meetNavigateTargetFromSelection(channelId: string): MeetChatNavigateTarget {
  const peerId = meetDirectMessagePrincipalId(channelId);
  if (peerId) {
    return { to: MEET_DMS_ROUTE, params: { peerId } };
  }
  return { to: MEET_CHANNELS_ROUTE, params: { channelId } };
}

/**
 * Cheap `/meet/{legacyId}` remap. `dm:{peer}` and channel ids (including `chat-…`)
 * round-trip. Server `dm-{hash}` collections are not a 1:1 map to a directory
 * principal — those bookmarks fall through to bare `/meet` (default channel).
 */
export function meetLegacyRedirect(legacyId: string): MeetChatLegacyRedirect {
  const id = decodeLegacySegment(legacyId);
  if ((MEET_LEGACY_RESERVED_SEGMENTS as readonly string[]).includes(id)) {
    return { to: "/meet" };
  }
  const peerId = meetDirectMessagePrincipalId(id);
  if (peerId) {
    return { to: MEET_DMS_ROUTE, params: { peerId } };
  }
  if (id.startsWith(MEET_SERVER_DM_COLLECTION_PREFIX)) {
    return { to: "/meet" };
  }
  return { to: MEET_CHANNELS_ROUTE, params: { channelId: id } };
}

function decodeLegacySegment(legacyId: string): string {
  try {
    return decodeURIComponent(legacyId);
  } catch {
    return legacyId;
  }
}
