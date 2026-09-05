export type MeetCallStageLayout = "collapsed" | "compact" | "side-by-side" | "fullscreen";

/** Sticky-bar invite while a meeting is live and this user has not joined. Start never lives here. */
export type MeetCallInvite = "join";

export function meetCallIsActive(layout: MeetCallStageLayout): boolean {
  return layout !== "collapsed";
}

/** Meeting exists on this channel (anyone started), independent of expand chrome. */
export function meetChannelMeetingLive(options: {
  channelCallActive?: boolean;
  localCallActive?: boolean;
}): boolean {
  return Boolean(options.channelCallActive || options.localCallActive);
}

/**
 * Live/mesh/poll flag for the open conversation. DMs are not in `channels`,
 * so fixture `selected.callActive` is never set — `callActiveByChannel` is
 * the SST for `dm:{peer}` (and a belt-and-suspenders for real channels).
 */
/** Mesh hint OR room-status poll — never let a false poll wipe a live hint. */
export function mergeMeetCallActive(
  ...sources: readonly Record<string, boolean>[]
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const source of sources) {
    for (const [id, active] of Object.entries(source)) {
      if (active) out[id] = true;
    }
  }
  return out;
}

export function meetSelectedConversationLive(
  selected: { callActive?: boolean } | null,
  selectedId: string | null,
  callActiveByChannel?: Record<string, boolean>,
): boolean {
  if (!selectedId) return false;
  return Boolean(selected?.callActive || callActiveByChannel?.[selectedId]);
}

/**
 * Sticky-bar Join only. Start lives in ViewHeader; hidden after this user joins.
 * Does not control expand.
 */
export function meetCallInviteAction(
  meetingLive: boolean,
  localJoined: boolean,
): MeetCallInvite | null {
  if (localJoined || !meetingLive) return null;
  return "join";
}

/** ViewHeader Start — only when no meeting is live on this channel. */
export function meetCallHeaderStartVisible(meetingLive: boolean): boolean {
  return !meetingLive;
}

export function meetCallStageShowsBar(layout: MeetCallStageLayout): boolean {
  return layout === "compact";
}

/**
 * Sticky bar / tile strip when this channel has a live meeting and the stage is not expanded.
 * Idle channels show no chrome.
 */
export function meetCallBarVisible(layout: MeetCallStageLayout, meetingLive = true): boolean {
  return meetingLive && !meetCallStageShowsStage(layout);
}

/** Mic / camera / settings / expand / leave — only after this user joins. */
export function meetCallChromeVisible(localJoined: boolean): boolean {
  return localJoined;
}

export function meetCallStageShowsChat(_layout: MeetCallStageLayout): boolean {
  return true;
}

export function meetCallStageShowsStage(layout: MeetCallStageLayout): boolean {
  return layout === "side-by-side" || layout === "fullscreen";
}

/** Sidebar Live mark: fixture `callActive` or a local join on that channel. */
export function meetSidebarRowIsLive(options: {
  channelCallActive?: boolean;
  localCallActive?: boolean;
}): boolean {
  return Boolean(options.channelCallActive || options.localCallActive);
}
