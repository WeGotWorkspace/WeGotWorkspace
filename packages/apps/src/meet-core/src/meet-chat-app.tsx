import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { createWgwMeetOperations } from "@/lib/api/wgw/meet";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { findCachedDmChannelByPeer } from "@/lib/offline/meet-chat-offline-store";
import { latestMessageInChannel } from "@/lib/offline/meet-chat/meet-chat-read-marker";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import { meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import { meetChannelTitle } from "@/meet-core/src/meet-channel-label";
import type { MeetChatApiSource } from "@/meet-core/src/meet-chat-api-source";
import { mergeAuthorPresence } from "@/meet-core/src/meet-author-presence";
import {
  meetLegacyRedirect,
  meetNavigateTargetFromSelection,
  meetSelectionFromRouteParams,
  type MeetChatRouteParams,
} from "@/meet-core/src/meet-chat-route";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import type { MeetAPIOperations, MeetChatOperations, MeetUIData } from "@/meet-core/src/meet-types";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { useMeetAuthorPresence } from "@/meet-core/src/use-meet-author-presence";
import { useMeetChatAPI } from "@/meet-core/src/use-meet-chat-api";
import { useMeetChannelReadMarker } from "@/meet-core/src/use-meet-channel-read-marker";
import { useMeetChannelTyping } from "@/meet-core/src/use-meet-channel-typing";
import { useMeetChatCall } from "@/meet-core/src/use-meet-chat-call";
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
  const routeChannelId = meetSelectionFromRouteParams(params);
  const routeChannelIdRef = useRef(routeChannelId);
  routeChannelIdRef.current = routeChannelId;
  const navigate = useNavigate();

  // Cheap `/meet/{legacyId}` → nested path (replace so Back skips the old URL).
  useEffect(() => {
    if (!params.legacyId) return;
    void navigate({ ...meetLegacyRedirect(params.legacyId), replace: true });
  }, [navigate, params.legacyId]);

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
        void navigate({
          ...meetNavigateTargetFromSelection(channelId),
          replace: routeChannelIdRef.current === null,
        });
      }
    },
    [chatOperations, navigate],
  );

  const { operations, callStageRoom, liveCallChannelId, joinedRoomCode } = useMeetChatCall({
    session,
    data,
    identityReady: !listLoading,
    channels,
    meetOperations,
    chatOperations,
  });

  const {
    meshCallParticipants,
    meshCallAudioOnly,
    operations: operationsWithMesh,
  } = useMeetMeshSync({
    operations,
    liveCallChannelId,
    username: session.user.username ?? null,
    selfUsername: session.user.username,
    channels,
    directory: data.directory,
    onApplied: patchFromCache,
  });

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

  // Mini-player title: the live call's channel/meeting title or DM peer name.
  const suiteCallStore = useMeetCallStoreContext();
  useEffect(() => {
    if (!suiteCallStore) return;
    if (!liveCallChannelId) {
      suiteCallStore.setCallLabel(null);
      return;
    }
    const dmPrincipal = meetDirectMessagePrincipalId(liveCallChannelId);
    if (dmPrincipal) {
      const person = data.directory?.find((principal) => principal.id === dmPrincipal);
      suiteCallStore.setCallLabel(person?.displayName?.trim() || dmPrincipal);
      return;
    }
    const channel = channels.find((row) => row.id === liveCallChannelId);
    suiteCallStore.setCallLabel(channel ? meetChannelTitle(channel) : null);
  }, [channels, data.directory, liveCallChannelId, suiteCallStore]);

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
      initialChannelId={routeChannelId ?? liveCallChannelId ?? undefined}
      routeChannelId={routeChannelId}
      liveCallChannelId={liveCallChannelId}
      onSelectedChannelChange={handleSelectedChannelChange}
      typingByChannel={typingByChannel}
      onComposerTyping={onComposerTyping}
      callActiveByChannel={callActiveByChannel}
      callParticipantsByChannel={meshCallParticipants}
      callAudioOnlyByChannel={meshCallAudioOnly}
      onCaughtUpChange={setCaughtUp}
    />
  );
}

/**
 * Live `/meet` composition (chunk F): the Slack-like `MeetWorkspace` on the
 * hybrid chat client (chunk E) with a call stage driven by the real Meet
 * controller. `startCall`/`leaveCall` join the deterministic channel room
 * (`meet-channel-room.ts`); the guest flow stays on `MeetApp`/`/meet/join`.
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
