import { isMeetRoomCode } from "@/calendar-core/src/calendar-meet-link";
import { meetCallIsActive, type MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetCallStatus } from "@/meet-core/src/meet-call-types";
import {
  MEET_MEETINGS_ROUTE,
  meetNavigateTargetFromSelection,
  type MeetChatNavigateTarget,
} from "@/meet-core/src/meet-chat-route";

export type MeetResumeCallNavigateTarget = MeetChatNavigateTarget | { to: "/meet" };

/** Session is live enough to restore call chrome after a route remount. */
export function meetCallStatusEngaged(status: MeetCallStatus): boolean {
  return status === "in-call" || status === "preparing" || status === "waiting";
}

/**
 * Mini-player only hides on `/meet` when the workspace has parked the call
 * (live channel not on screen). Outside `/meet` it always accompanies an engaged call.
 */
export function meetCallMiniPlayerVisible(input: {
  callEngaged: boolean;
  onMeetPath: boolean;
  callUiParked: boolean;
}): boolean {
  return input.callEngaged && (!input.onMeetPath || input.callUiParked);
}

/**
 * Prefer the room→channel mapping from the current mount. While the call is
 * still engaged, keep the suite-persisted id so a remount (app switcher back
 * to `/meet`) can restore the live channel even if DM/ad-hoc refs were lost.
 */
export function meetResumeLiveCallChannelId(input: {
  computed: string | null;
  persisted: string | null;
  callEngaged: boolean;
}): string | null {
  if (input.computed) return input.computed;
  if (input.callEngaged) return input.persisted;
  return null;
}

/**
 * Bare `/meet` (app switcher) should land on the live call. Nested routes keep
 * their own selection so a parked call on another channel stays parked.
 */
export function meetShouldSelectLiveCallOnBareMeet(input: {
  routeChannelId: string | null | undefined;
  liveCallChannelId: string | null | undefined;
}): string | null {
  if (input.routeChannelId != null) return null;
  return input.liveCallChannelId ?? null;
}

/**
 * Leaving Meet unmounts the workspace chrome. If the call is still engaged,
 * keep the mini-player parked so returning to `/meet` does not hide it before
 * the in-call stage is back on screen. Legacy guest shells never set parked.
 */
export function meetCallUiParkedOnWorkspaceUnmount(callEngaged: boolean): boolean {
  return callEngaged;
}

/**
 * Chrome to restore after Meet remounts mid-call. Compact is the join default;
 * expanded/fullscreen only come back if the user left them that way.
 */
export function meetResumeCallLayout(
  persisted: MeetCallStageLayout | null | undefined,
): MeetCallStageLayout {
  return persisted && meetCallIsActive(persisted) ? persisted : "compact";
}

/**
 * Nested Meet path for the live call. Avoids `/meet?room=` which the invite
 * gate treats as a leftover meeting and drops workspace call chrome.
 */
export function meetResumeCallNavigateTarget(input: {
  liveCallChannelId: string | null;
  liveCallChannelKind?: string | null;
  roomCode?: string | null;
}): MeetResumeCallNavigateTarget {
  if (input.liveCallChannelId) {
    return meetNavigateTargetFromSelection(input.liveCallChannelId, {
      kind: input.liveCallChannelKind,
    });
  }
  const room = input.roomCode?.trim();
  if (!room) return { to: "/meet" };
  if (isMeetRoomCode(room)) {
    return { to: MEET_MEETINGS_ROUTE, params: { meetingId: room.toLowerCase() } };
  }
  return meetNavigateTargetFromSelection(room);
}
