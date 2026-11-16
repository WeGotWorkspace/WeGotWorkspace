import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { wgwHasAuthenticatedSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { meetRoomFromSearch, parseMeetRouteSearch } from "@/lib/meetings/meet-route-search";
import {
  MEET_MEETINGS_ROUTE,
  meetIsAdHocMeetingId,
  meetLiveRouteShowsInviteGate,
  meetRouteIsGuestClosed,
  type MeetChatRouteParams,
} from "@/meet-core/src/meet-chat-route";
import { MeetChatApp } from "@/meet-core/src/meet-chat-app";
import { MeetInviteGate, MeetChannelDeepLinkGate } from "@/meet-core/src/meet-invite-gate";
import { withWeGotWorkspaceAuth } from "@/wegotworkspace/src/wegotworkspace-require-auth";

/* Lazy route module: Meet loads only when a `/meet` route opens (#1628). */

const AuthenticatedMeetChatApp = withWeGotWorkspaceAuth(MeetChatApp);

export function MeetLiveRoute() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as MeetChatRouteParams;
  const search = useSearch({ strict: false });
  const parsedSearch = useMemo(
    () => parseMeetRouteSearch(search as Record<string, unknown>),
    [search],
  );
  const roomFromSearch = meetRoomFromSearch(parsedSearch);
  const meetingId = params.meetingId?.trim() || null;
  const adHocMeeting = meetIsAdHocMeetingId(meetingId);
  const persistedMeetingId = meetingId && !adHocMeeting ? meetingId : null;
  const inviteRoom = adHocMeeting ? meetingId : roomFromSearch;
  const channelId = params.channelId ?? null;
  const onConversationRoute = Boolean(
    channelId || params.peerId || params.legacyId || persistedMeetingId,
  );

  useEffect(() => {
    if (meetingId || onConversationRoute || !roomFromSearch) return;
    void navigate({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: roomFromSearch },
      search: {},
      replace: true,
    });
  }, [meetingId, navigate, onConversationRoute, parsedSearch, roomFromSearch]);

  // Signed-in members stay on one MeetChatApp for channels, DMs, persisted
  // meetings, and ad-hoc room codes. The invite gate is only the signed-out
  // ad-hoc lobby. Channels, DMs, and saved meetings refuse guests.
  const signedIn = wgwLiveApiEnabled() && wgwHasAuthenticatedSession();
  const guestClosed = meetRouteIsGuestClosed({
    channelId,
    peerId: params.peerId ?? null,
    persistedMeetingId,
    legacyId: params.legacyId ?? null,
  });
  if (
    !guestClosed &&
    meetLiveRouteShowsInviteGate({
      signedIn,
      meetingId,
      onConversationRoute,
      inviteRoom,
    })
  ) {
    return <MeetInviteGate room={adHocMeeting ? meetingId : inviteRoom} />;
  }
  return (
    <MeetChannelDeepLinkGate
      channelId={channelId}
      guestClosed={guestClosed}
      workspace={<AuthenticatedMeetChatApp />}
    />
  );
}
