export type MeetCallStageLayout = "collapsed" | "compact" | "side-by-side" | "fullscreen";

export type MeetCallInvite = "start" | "join";

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
 * Sticky-bar Start / Join. Hidden after this user joins (AV chrome takes over).
 * Does not control expand.
 */
export function meetCallInviteAction(
  meetingLive: boolean,
  localJoined: boolean,
): MeetCallInvite | null {
  if (localJoined) return null;
  if (meetingLive) return "join";
  return "start";
}

export function meetCallStageShowsBar(layout: MeetCallStageLayout): boolean {
  return layout === "compact";
}

/** Idle Start, live Join, or joined AV. Hidden only when the expanded stage is up. */
export function meetCallBarVisible(layout: MeetCallStageLayout): boolean {
  return !meetCallStageShowsStage(layout);
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
