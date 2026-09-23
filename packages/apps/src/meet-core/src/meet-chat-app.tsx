import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createWgwMeetOperations } from "@/lib/api/wgw/meet";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { findCachedDmChannelByPeer } from "@/lib/offline/meet-chat-offline-store";
import { latestMessageInChannel } from "@/lib/offline/meet-chat/meet-chat-read-marker";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { useCalendarAPI } from "@/calendar-core/src/use-calendar-api";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import {
  meetCallStatusEngaged,
  meetResumeCallLayout,
  meetResumeLiveCallChannelId,
} from "@/meet-core/src/meet-call-resume";
import { upcomingMeetingsForSidebar } from "@/meet-core/src/meet-calendar-meeting";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import {
  meetSignedInMeetingRouteJoin,
  meetSignedInUpcomingJoin,
} from "@/meet-core/src/meet-signed-in-join";
import { meetChannelTitle } from "@/meet-core/src/meet-channel-label";
import type { MeetChatApiSource } from "@/meet-core/src/meet-chat-api-source";
import { mergeAuthorPresence } from "@/meet-core/src/meet-author-presence";
import {
  MEET_CHANNELS_ROUTE,
  MEET_MEETINGS_ROUTE,
  meetIsAdHocMeetingId,
  meetLegacyRedirect,
  meetMeetingPathId,
  meetNavigatePathFromSelection,
  meetNavigateTargetFromSelection,
  meetSelectionFromRouteParams,
  type MeetChatRouteParams,
} from "@/meet-core/src/meet-chat-route";
import { useNotificationsMarkReadOnConsume } from "@/notifications-core/src/use-notifications-mark-read-on-consume";
import {
  meetChannelIdsEqual,
  meetCollectionIdFromPublic,
  meetPublicChannelId,
} from "@/meet-core/src/meet-public-id";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import type { MeetAPIOperations, MeetChatOperations, MeetUIData } from "@/meet-core/src/meet-types";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { useMeetAuthorPresence } from "@/meet-core/src/use-meet-author-presence";
import { useMeetChatAPI } from "@/meet-core/src/use-meet-chat-api";
import { useMeetChannelReadMarker } from "@/meet-core/src/use-meet-channel-read-marker";
import { useMeetChannelTyping } from "@/meet-core/src/use-meet-channel-typing";
import { useMeetChatCall } from "@/meet-core/src/use-meet-chat-call";
import { useMeetNowClock } from "@/meet-core/src/use-meet-now-clock";
import { mergeMeetCallLive } from "@/meet-core/src/meet-call-stage-layout";
import { useMeetChannelCallActivity } from "@/meet-core/src/use-meet-channel-call-activity";
import { useMeetMeshSync } from "@/meet-core/src/use-meet-mesh-sync";

export type MeetChatAppProps = {
  /** Chat bootstrap/ops source (defaults to the hybrid Dexie + REST source). */
  source?: MeetChatApiSource;
  /** Meet signaling REST surface (defaults to the authenticated live client). */
  createMeetOperations?: () => MeetAPIOperations;
};

function MeetChatLiveWorkspace({
  data,
  session,
  chatOperations,
  meetOperations,
  listLoading,
  onLogout,
  patchFromCache,
}: {
  data: MeetUIData;
  session: WorkspaceSession;
  chatOperations?: MeetChatOperations;
  meetOperations: MeetAPIOperations;
  listLoading: boolean;
  onLogout: () => void;
  patchFromCache: () => Promise<void>;
}) {
  const channels = useMemo(() => data.channels ?? [], [data.channels]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [caughtUp, setCaughtUp] = useState(true);

  // Deep links: /meet/channels/$channelId and /meet/dms/$peerId ↔ workspace
  // selection. Nested children of /meet, so switching never remounts this app.
  const params = useParams({ strict: false }) as MeetChatRouteParams;
  const adHocMeetingId = meetIsAdHocMeetingId(params.meetingId)
    ? (params.meetingId?.trim().toLowerCase() ?? null)
    : null;
  const adHocChannelId = adHocMeetingId ? meetChannelIdForRoom(channels, adHocMeetingId) : null;
  const routeChannelId = meetSelectionFromRouteParams(params) ?? adHocChannelId;
  const unmatchedAdHocRoom =
    !listLoading && adHocMeetingId && !adHocChannelId ? adHocMeetingId : null;
  const routeChannelIdRef = useRef(routeChannelId);
  routeChannelIdRef.current = routeChannelId;
  const navigate = useNavigate();

  // Cheap `/meet/{legacyId}` → nested path (replace so Back skips the old URL).
  useEffect(() => {
    if (!params.legacyId) return;
    void navigate({ ...meetLegacyRedirect(params.legacyId), replace: true });
  }, [navigate, params.legacyId]);

  // `/meet/channels/chat-…` bookmarks → unprefixed `/meet/channels/{id}`.
  useEffect(() => {
    if (!params.channelId) return;
    const publicId = meetPublicChannelId(params.channelId);
    if (publicId === params.channelId) return;
    void navigate({
      to: MEET_CHANNELS_ROUTE,
      params: { channelId: publicId },
      replace: true,
    });
  }, [navigate, params.channelId]);

  // DM rail click: eagerly find-or-create the backing dm- collection (chunk G)
  // so history/unread sync starts before the first message. Best-effort — a
  // failure just defers provisioning to the first send/call.
  const handleSelectedChannelChange = useCallback(
    (channelId: string | null) => {
      setSelectedChannelId(channelId);
      setCaughtUp(true);
      const dmPrincipal = channelId ? meetDirectMessagePrincipalId(channelId) : null;
      if (dmPrincipal) void chatOperations?.openDm?.(dmPrincipal).catch(() => undefined);
      // Reflect the selection in the URL. The very first sync (landing on bare
      // /meet) replaces instead of pushing, so Back leaves the app.
      if (channelId && channelId !== routeChannelIdRef.current) {
        const row = channels.find((channel) => channel.id === channelId);
        void navigate({
          ...meetNavigateTargetFromSelection(channelId, row),
          replace: routeChannelIdRef.current === null,
        });
      }
    },
    [channels, chatOperations, navigate],
  );

  // Meeting-kind collections live on `/meet/meetings/{id}`, not `/meet/channels/{id}`.
  useEffect(() => {
    if (!params.channelId || listLoading) return;
    const row = channels.find((channel) =>
      meetChannelIdsEqual(channel.id, meetCollectionIdFromPublic(params.channelId ?? "")),
    );
    if (row?.kind !== "meeting") return;
    void navigate({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: meetMeetingPathId(row.id, row) },
      replace: true,
    });
  }, [channels, listLoading, navigate, params.channelId]);

  // Ad-hoc meetings stay on the reserved room code, never the collection slug.
  useEffect(() => {
    if (!params.meetingId || listLoading || meetIsAdHocMeetingId(params.meetingId)) return;
    const channelId = meetCollectionIdFromPublic(params.meetingId);
    const row = channels.find((channel) => meetChannelIdsEqual(channel.id, channelId));
    if (row?.kind !== "meeting") return;
    const room = meetMeetingPathId(row.id, row);
    if (!meetIsAdHocMeetingId(room) || room === params.meetingId.trim().toLowerCase()) return;
    void navigate({
      to: MEET_MEETINGS_ROUTE,
      params: { meetingId: room },
      replace: true,
    });
  }, [channels, listLoading, navigate, params.meetingId]);

  const suiteCallStore = useMeetCallStoreContext();
  const { operations, callStageRoom, liveCallChannelId, joinedRoomCode, joinAdHocRoom } =
    useMeetChatCall({
      session,
      data,
      identityReady: !listLoading,
      channels,
      meetOperations,
      chatOperations,
    });
  const joinedUnmappedAdHoc = Boolean(
    joinedRoomCode &&
    meetIsAdHocMeetingId(joinedRoomCode) &&
    !meetChannelIdForRoom(channels, joinedRoomCode),
  );
  const resumeLiveCallChannelId = joinedUnmappedAdHoc
    ? null
    : meetResumeLiveCallChannelId({
        computed: liveCallChannelId,
        persisted: suiteCallStore?.getSnapshot().liveCallChannelId ?? null,
        callEngaged: Boolean(joinedRoomCode),
      });

  const calendarApi = useCalendarAPI();
  const [createdEvents, setCreatedEvents] = useState<JmapCalendarEvent[]>([]);
  const [deletedEventIds, setDeletedEventIds] = useState<string[]>([]);
  const calendarEvents = useMemo(() => {
    const byId = new Map(calendarApi.data.events.map((event) => [event.id, event]));
    for (const event of createdEvents) byId.set(event.id, event);
    for (const eventId of deletedEventIds) byId.delete(eventId);
    return [...byId.values()];
  }, [calendarApi.data.events, createdEvents, deletedEventIds]);
  const workspaceOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const nowTick = useMeetNowClock();
  const upcomingMeetings = useMemo(
    () => upcomingMeetingsForSidebar(calendarEvents, nowTick, workspaceOrigin),
    [calendarEvents, nowTick, workspaceOrigin],
  );
  const calendarMeetOperations = useMemo<CalendarMeetOperations>(
    () => ({
      roomStatus: meetOperations.roomStatus,
      reserveRoom: meetOperations.reserveRoom,
      patchRoomExpiresAt: meetOperations.patchRoomExpiresAt,
    }),
    [meetOperations],
  );
  const handleMeetingCreated = useCallback(
    (event: JmapCalendarEvent) => {
      setCreatedEvents((current) => [...current, event]);
      setDeletedEventIds((current) => current.filter((eventId) => eventId !== event.id));
      void calendarApi.refreshBootstrap?.();
    },
    [calendarApi],
  );
  const handleEventUpdated = useCallback(
    (event: JmapCalendarEvent) => {
      setCreatedEvents((current) => {
        const rest = current.filter((row) => row.id !== event.id);
        return [...rest, event];
      });
      setDeletedEventIds((current) => current.filter((id) => id !== event.id));
      void calendarApi.refreshBootstrap?.();
    },
    [calendarApi],
  );
  const handleEventDeleted = useCallback(
    (eventId: string) => {
      setCreatedEvents((current) => current.filter((event) => event.id !== eventId));
      setDeletedEventIds((current) =>
        current.includes(eventId) ? current : [...current, eventId],
      );
      void calendarApi.refreshBootstrap?.();
    },
    [calendarApi],
  );

  const {
    meshCallParticipants,
    meshCallAudioOnly,
    operations: operationsWithMesh,
  } = useMeetMeshSync({
    operations,
    liveCallChannelId: resumeLiveCallChannelId,
    username: session.user.username ?? null,
    selfUsername: session.user.username,
    channels,
    directory: data.directory,
    onApplied: patchFromCache,
  });

  const joinedInviteRef = useRef<string | null>(null);
  const suppressRouteJoinRef = useRef(false);
  const handleJoinUpcomingMeeting = useCallback(
    (href: string) => {
      const action = meetSignedInUpcomingJoin(href, workspaceOrigin, channels);
      if (action.action === "select-channel") {
        handleSelectedChannelChange(action.channelId);
        return;
      }
      if (action.action === "start-call") {
        const row = channels.find((channel) => channel.id === action.channelId);
        const room = row ? meetMeetingPathId(row.id, row) : null;
        if (room && meetIsAdHocMeetingId(room)) joinedInviteRef.current = room;
        handleSelectedChannelChange(action.channelId);
        void operations?.startCall?.(action.channelId);
        return;
      }
      if (action.action === "join-room") {
        const onRoom = params.meetingId?.trim().toLowerCase() === action.room;
        if (!onRoom) {
          void navigate({
            to: MEET_MEETINGS_ROUTE,
            params: { meetingId: action.room },
          });
          return;
        }
        void joinAdHocRoom(action.room);
      }
    },
    [
      channels,
      handleSelectedChannelChange,
      joinAdHocRoom,
      navigate,
      operations,
      params.meetingId,
      workspaceOrigin,
    ],
  );

  // Sidebar selection of a meeting the user already has navigates to the room
  // code. That must not also start the call; opening the link still does.
  const handleUserSelectedChannelChange = useCallback(
    (channelId: string | null) => {
      const row = channelId ? channels.find((channel) => channel.id === channelId) : null;
      const room = row ? meetMeetingPathId(row.id, row) : null;
      if (row?.kind === "meeting" && room && meetIsAdHocMeetingId(room)) {
        suppressRouteJoinRef.current = true;
      }
      handleSelectedChannelChange(channelId);
    },
    [channels, handleSelectedChannelChange],
  );
  useEffect(() => {
    const meetingId = params.meetingId?.trim().toLowerCase() || null;
    if (!meetingId || listLoading) return;
    const action = meetSignedInMeetingRouteJoin(meetingId, channels);
    if (action.action === "start-call") {
      if (!operations?.startCall) return;
      const suppressed = suppressRouteJoinRef.current;
      suppressRouteJoinRef.current = false;
      if (joinedInviteRef.current === meetingId) return;
      joinedInviteRef.current = meetingId;
      handleSelectedChannelChange(action.channelId);
      if (!suppressed) void operations.startCall(action.channelId);
      return;
    }
    suppressRouteJoinRef.current = false;
    if (action.action === "join-room") {
      if (joinedInviteRef.current === meetingId) return;
      joinedInviteRef.current = meetingId;
      void joinAdHocRoom(action.room);
      return;
    }
    const mapped = meetChannelIdForRoom(channels, meetingId);
    if (mapped) handleSelectedChannelChange(mapped);
  }, [
    channels,
    handleSelectedChannelChange,
    joinAdHocRoom,
    listLoading,
    operations,
    params.meetingId,
  ]);

  const liveAuthorPresence = useMeetAuthorPresence();
  const { typingByChannel, onComposerTyping } = useMeetChannelTyping();

  const selectedReadSignal = useMemo(() => {
    if (!selectedChannelId) {
      return { latestMessageId: null as string | null, unreadCount: 0 };
    }
    const latest = latestMessageInChannel(data.messages ?? [], selectedChannelId);
    const peer = meetDirectMessagePrincipalId(selectedChannelId);
    const unreadCount = peer
      ? (data.dmUnread?.[peer] ?? 0)
      : (data.channels?.find((row) => row.id === selectedChannelId)?.unreadCount ?? 0);
    return { latestMessageId: latest?.id ?? null, unreadCount };
  }, [data.channels, data.dmUnread, data.messages, selectedChannelId]);

  useMeetChannelReadMarker({
    selectedChannelId,
    markChannelRead: operationsWithMesh?.markChannelRead,
    selectedLatestMessageId: selectedReadSignal.latestMessageId,
    selectedUnreadCount: selectedReadSignal.unreadCount,
    caughtUp,
  });

  const selectedSuiteNavigate = useMemo(() => {
    if (!selectedChannelId) return null;
    const row = channels.find((channel) => channel.id === selectedChannelId);
    return meetNavigatePathFromSelection(selectedChannelId, row);
  }, [channels, selectedChannelId]);

  useNotificationsMarkReadOnConsume({
    navigate: selectedSuiteNavigate,
    caughtUp,
  });

  const resolveDmRoom = useCallback(
    async (channelId: string) => {
      const peer = meetDirectMessagePrincipalId(channelId);
      const account = session.user.username;
      if (!peer || !account) return null;
      const row = await findCachedDmChannelByPeer(account, peer);
      return row ? meetChannelRoomId({ id: row.id, kind: "channel" }) : null;
    },
    [session.user.username],
  );

  const meshEndedChannelIds = useMemo(
    () =>
      Object.keys(meshCallParticipants).filter(
        (id) => (meshCallParticipants[id]?.length ?? 0) === 0,
      ),
    [meshCallParticipants],
  );
  const polledCallActive = useMeetChannelCallActivity({
    operations: meetOperations,
    channels,
    selectedChannelId,
    joinedRoomCode,
    resolveRoom: resolveDmRoom,
    omitChannelIds: meshEndedChannelIds,
  });
  const callActiveByChannel = mergeMeetCallLive(meshCallParticipants, polledCallActive);

  // Persist the live call's channel so a remount (app switcher → /meet) can
  // restore chrome. Do not clear the mapping while the call is still engaged
  // but this mount cannot resolve the room yet (lost DM/ad-hoc refs).
  useEffect(() => {
    if (!suiteCallStore) return;
    if (joinedUnmappedAdHoc) {
      suiteCallStore.setLiveCallChannelId(null);
      suiteCallStore.setLiveCallChannelKind(null);
      return;
    }
    if (liveCallChannelId) {
      suiteCallStore.setLiveCallChannelId(liveCallChannelId);
      const dmPrincipal = meetDirectMessagePrincipalId(liveCallChannelId);
      if (dmPrincipal) {
        const person = data.directory?.find((principal) => principal.id === dmPrincipal);
        suiteCallStore.setLiveCallChannelKind("dm");
        suiteCallStore.setCallLabel(person?.displayName?.trim() || dmPrincipal);
        return;
      }
      const channel = channels.find((row) => row.id === liveCallChannelId);
      suiteCallStore.setLiveCallChannelKind(channel?.kind ?? "channel");
      suiteCallStore.setCallLabel(channel ? meetChannelTitle(channel) : null);
      return;
    }
    if (!meetCallStatusEngaged(suiteCallStore.getSnapshot().status)) {
      suiteCallStore.clearLiveCallResume();
    }
  }, [channels, data.directory, joinedUnmappedAdHoc, liveCallChannelId, suiteCallStore]);

  const workspaceData = useMemo<MeetUIData>(() => {
    const authorPresence = mergeAuthorPresence(liveAuthorPresence, data.authorPresence);
    const liveByChannel = callActiveByChannel;
    const withCalls =
      Object.keys(liveByChannel).length === 0
        ? data
        : {
            ...data,
            channels: channels.map((channel) =>
              liveByChannel[channel.id] && !channel.callActive
                ? { ...channel, callActive: true }
                : channel,
            ),
          };
    return authorPresence === withCalls.authorPresence
      ? withCalls
      : { ...withCalls, authorPresence };
  }, [callActiveByChannel, channels, data, liveAuthorPresence]);

  return (
    <MeetWorkspace
      data={workspaceData}
      session={session}
      operations={operationsWithMesh}
      onLogout={onLogout}
      callStageRoom={callStageRoom}
      // Deep link wins; otherwise returning to /meet mid-call lands on the call.
      initialChannelId={routeChannelId ?? resumeLiveCallChannelId ?? undefined}
      initialCallLayout={
        resumeLiveCallChannelId
          ? meetResumeCallLayout(suiteCallStore?.getSnapshot().callUiLayout)
          : undefined
      }
      routeChannelId={routeChannelId}
      unmatchedAdHocRoom={unmatchedAdHocRoom}
      liveCallChannelId={resumeLiveCallChannelId}
      onSelectedChannelChange={handleUserSelectedChannelChange}
      typingByChannel={typingByChannel}
      onComposerTyping={onComposerTyping}
      callActiveByChannel={callActiveByChannel}
      callParticipantsByChannel={meshCallParticipants}
      callAudioOnlyByChannel={meshCallAudioOnly}
      onCaughtUpChange={setCaughtUp}
      upcomingMeetings={upcomingMeetings}
      onJoinUpcomingMeeting={handleJoinUpcomingMeeting}
      calendar={{
        calendars: calendarApi.data.calendars,
        events: calendarEvents,
        createEvent: calendarApi.operations?.createEvent,
        patchEvent: calendarApi.operations?.patchEvent,
        deleteEvent: calendarApi.operations?.deleteEvent,
        meetOperations: calendarMeetOperations,
        sessionUsername: session.user.username,
        sessionDisplayName: session.user.displayName,
        sessionEmail: session.user.email,
        workspaceOrigin,
        onEventCreated: handleMeetingCreated,
        onEventUpdated: handleEventUpdated,
        onEventDeleted: handleEventDeleted,
      }}
    />
  );
}

/**
 * Live `/meet` composition (chunk F): the Slack-like `MeetWorkspace` on the
 * hybrid chat client (chunk E) with a call stage driven by the real Meet
 * controller. `startCall`/`leaveCall` join the deterministic channel room
 * (`meet-channel-room.ts`). Signed-in `/meet/channels/{id}` stays in this
 * workspace. Only signed-out invite landings mount `MeetGuestChannel`.
 */
export function MeetChatApp({ source, createMeetOperations }: MeetChatAppProps = {}) {
  const {
    phase,
    error,
    retry,
    successVersion,
    listLoading,
    data,
    session,
    operations,
    patchFromCache,
  } = useMeetChatAPI(source);
  const meetOperations = useMemo(
    () => (createMeetOperations ?? createWgwMeetOperations)(),
    [createMeetOperations],
  );

  const handleLogout = useCallback(() => {
    window.location.assign("/logout");
  }, []);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load live meet"
      successVersion={successVersion}
      render={(key) => (
        <MeetChatLiveWorkspace
          key={key}
          data={data}
          session={session}
          chatOperations={operations}
          meetOperations={meetOperations}
          listLoading={listLoading}
          onLogout={handleLogout}
          patchFromCache={patchFromCache}
        />
      )}
    />
  );
}
