import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { principalRoleFromToken } from "@/lib/api/wgw/principal-role";
import { wgwCurrentAccessToken } from "@/lib/api/wgw/http";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";
import { presentMeetRelayOutcome } from "@/meet-core/src/meet-relay-present";
import type { MeetRelayCopy } from "@/meet-core/src/meet-relay-copy";
import { parseUrlList } from "@/lib/rtc/config";
import { isRtcDebugEnabled } from "@/lib/rtc/debug";
import { rtcLog } from "@/lib/rtc/log";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import type { MeetRemotePeer } from "@/meet-core/src/meet-call-types";
import { acceptMeetDataChat } from "@/meet-core/src/meet-data-chat";
import { buildMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { shouldAcceptMeetOffer, shouldConnectMeetPeer } from "@/meet-core/src/meet-rtc-peers";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import type { MeetAPIOperations, MeetRtcSettings } from "@/meet-core/src/meet-types";
import { useMeetInboundMediaHints } from "@/meet-core/src/use-meet-inbound-media-hints";
import { useMeetLocalMedia } from "@/meet-core/src/use-meet-local-media";
import { useMeetPollHandler } from "@/meet-core/src/use-meet-poll-handler";
import { useMeetRtc } from "@/meet-core/src/use-meet-rtc";
import { useMeetSendEncoding } from "@/meet-core/src/use-meet-send-encoding";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";

export type UseMeetCallSessionArgs = {
  room: MeetRoomState;
  rtc: MeetRtcSettings;
  operations?: MeetAPIOperations;
  isGuestSession: boolean;
  leaveRef: MutableRefObject<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>;
  /** Suite-level store: RTC session + local media survive route unmounts. */
  callStore?: MeetCallStore;
};

export function useMeetCallSession({
  room,
  rtc,
  operations,
  isGuestSession,
  leaveRef,
  callStore,
}: UseMeetCallSessionArgs) {
  const toast = useAppToast();
  const presence = usePresenceStoreContext();
  const cameraBlockedRef = useRef(false);
  const [cameraSendingDisabled, setCameraSendingDisabled] = useState(false);
  const [relayBanner, setRelayBanner] = useState<MeetRelayCopy | null>(null);
  const [relayTiles, setRelayTiles] = useState<Readonly<Record<string, string>>>({});
  const rtcDebugEnabledRef = useRef(isRtcDebugEnabled());
  const operationsRef = useRef(operations);
  operationsRef.current = operations;

  const meetRtcRef = useRef<ReturnType<typeof useMeetRtc> | null>(null);
  const muteMicRef = useRef<null | (() => boolean)>(null);
  const unmuteMicRef = useRef<null | (() => boolean)>(null);
  const getLocalStreamRef = useRef<() => MediaStream | null>(() => null);
  const announceMediaPresenceRef = useRef<
    (mic: boolean, camera: boolean, screen?: boolean) => Promise<void>
  >(async () => {});

  const debugRtc = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      rtcLog({ channel: "meet", peerId: room.selfIdRef.current }, event, payload);
    },
    [room.selfIdRef],
  );

  const handlePollData = useMeetPollHandler({
    selfIdRef: room.selfIdRef,
    statusRef: room.statusRef,
    roomCodeRef: room.roomCodeRef,
    displayNameRef: room.displayNameRef,
    waitingForAdmissionRef: room.waitingForAdmissionRef,
    rosterRef: room.rosterRef,
    signalingRosterRef: room.signalingRosterRef,
    participantRosterDiffReadyRef: room.participantRosterDiffReadyRef,
    peerNamesRef: room.peerNamesRef,
    peerDisclosedMediaRef: room.peerDisclosedMediaRef,
    refreshPeersRef: room.refreshPeersRef,
    leaveRef,
    meetRtcRef,
    muteMicRef,
    unmuteMicRef,
    setKnockers: room.setKnockers,
    setEndedMessage: room.setEndedMessage,
    setStatus: room.setStatus,
    setStartedAt: room.setStartedAt,
    setWaitingForAdmission: room.setWaitingForAdmission,
    setChatMessages: room.setChatMessages,
  });

  const guestSignalingFetch = useMemo(
    () => (isGuestSession ? operations?.guestSignalingFetch?.() : undefined),
    [isGuestSession, operations],
  );

  const meetRtc = useMeetRtc({
    rtcSettings: rtc,
    persistentSessionRef: callStore?.rtcSessionRef,
    signalingFetch: guestSignalingFetch,
    getLocalStream: () => getLocalStreamRef.current(),
    onLinkChange: () => room.refreshPeersRef.current(),
    onPollData: handlePollData,
    shouldConnectToPeer: (peer: RtcPeerDescriptor) =>
      shouldConnectMeetPeer(peer, room.selfIdRef.current, room.waitingForAdmissionRef.current),
    shouldHandleRtcSignals: () => !room.waitingForAdmissionRef.current,
    // The lobby is not the call: a knocker's offer is dropped here too, not
    // only by the server, so a forged or racing one is never answered.
    shouldAcceptOffer: (from: string) =>
      shouldAcceptMeetOffer(room.signalingRosterRef.current, from),
    onPeerRemoved: (peerId, name) => {
      room.peerNamesRef.current.delete(peerId);
      room.peerInboundSampleRef.current.delete(peerId);
      room.peerMediaHintRef.current.delete(peerId);
      room.peerDisclosedMediaRef.current.delete(peerId);
      room.refreshPeersRef.current();
      if (
        room.statusRef.current === "in-call" &&
        peerId !== room.selfIdRef.current &&
        room.selfIdRef.current
      ) {
        toast.show(meetLabels.participantLeft(name), { severity: "info" });
      }
    },
    onConnectionFailed: (_peerId, peerName) => {
      room.setError(`Connection to ${peerName} failed.`);
    },
    onPollError: (error) => {
      const message = error instanceof Error ? error.message : "Could not poll room updates.";
      debugRtc("poll-failed", { message });
      room.setError(message);
    },
    onPeerConnected: () => {
      void announceMediaPresenceRef.current(room.micOnRef.current, room.videoOnRef.current);
    },
    onMeetData: (remoteId, raw) => {
      acceptMeetDataChat({
        remoteId,
        raw,
        selfPeerId: room.selfIdRef.current,
        peerNames: room.peerNamesRef.current,
        setChatMessages: room.setChatMessages,
      });
    },
    onRelayOutcome: (remoteId, name, outcome) => {
      const selfId = room.selfIdRef.current;
      const displayName = remoteId === selfId ? (room.displayNameRef.current ?? name) : name;
      const presented = presentMeetRelayOutcome({
        role: principalRoleFromToken(wgwCurrentAccessToken()),
        selfId,
        remoteId,
        name: displayName,
        outcome: outcome.outcome,
      });
      if (presented.toast) toast.show(presented.toast, { severity: "warning" });
      if (presented.banner) setRelayBanner(presented.banner);
      const tile = presented.tile;
      if (tile) {
        setRelayTiles((current) => ({ ...current, [tile.peerId]: tile.message }));
      }
    },
    onVideoLimits: (limits) => {
      const blocked = limits.maxVideoProfile === "audio";
      cameraBlockedRef.current = blocked;
      setCameraSendingDisabled(blocked);
      if (blocked) room.setVideoOn(false);
    },
  });
  meetRtcRef.current = meetRtc;
  const { lowData, setLowData } = useMeetSendEncoding(meetRtc);

  useEffect(() => {
    if (!presence) return;
    return presence.subscribeMeetJoinHint((hintRoom) => {
      if (hintRoom !== room.roomCodeRef.current) return;
      meetRtcRef.current?.kickPoll();
    });
  }, [presence, room.roomCodeRef]);

  useEffect(() => {
    debugRtc("controller-init", {
      rtcDebugEnabled: rtcDebugEnabledRef.current,
      stunCount: parseUrlList(rtc.stunUrls, "stun").length,
      forceRelay: rtc.forceRelay,
      turnAvailable: rtc.turnAvailable,
    });
  }, [debugRtc, rtc]);

  const refreshPeers = useCallback(() => {
    const next: MeetRemotePeer[] = [];
    const selfId = room.selfIdRef.current ?? meetRtc.getMyId();
    for (const id of meetRtc.getPeerIds()) {
      if (selfId && id === selfId) continue;
      const pc = meetRtc.getPeerConnection(id);
      const name = room.peerNamesRef.current.get(id) ?? "Peer";
      const stream = meetRtc.getRemoteStream(id);
      const connectionState = pc?.connectionState ?? "new";
      const connected = connectionState === "connected";
      next.push({
        id,
        name,
        stream,
        connectionState,
        remoteMedia: connected ? (room.peerMediaHintRef.current.get(id) ?? null) : null,
        disclosedMedia: room.peerDisclosedMediaRef.current.get(id) ?? null,
      });
    }
    room.setPeers(next);
    // Room setters/refs are stable; omit the room object to avoid recreating refreshPeers every render.
  }, [meetRtc]);
  room.refreshPeersRef.current = refreshPeers;

  const announceMediaPresence = useCallback(
    async (mic: boolean, camera: boolean, screen?: boolean) => {
      if (!operationsRef.current || !room.roomCodeRef.current || !room.selfIdRef.current) return;
      if (room.statusRef.current !== "in-call") return;
      const screenOnNow = screen ?? room.screenOnRef.current;
      try {
        await operationsRef.current.chat({
          room: room.roomCodeRef.current,
          from: room.selfIdRef.current,
          text: buildMeetControlMessage({
            kind: "media",
            mic,
            camera,
            screen: screenOnNow,
          }),
          sessionKey: meetRtc.getSessionKey() ?? undefined,
        });
      } catch {
        // Best-effort; peers may still infer from tracks or RTP stats.
      }
    },
    // Room fields are read via refs; omit the room object to keep this callback stable.
    [meetRtc],
  );
  announceMediaPresenceRef.current = announceMediaPresence;

  const {
    localVideoRef,
    screenPreviewStream,
    audioInputs,
    audioOutputs,
    videoInputs,
    selectedMicId,
    selectedCamId,
    ensureLocalMedia,
    stopLocalMedia,
    toggleMic,
    muteMic,
    unmuteMic,
    toggleVideo,
    toggleScreenShare,
    screenMode,
    startScreenShare,
    setScreenOptimize,
    stopScreenShare,
    switchMic,
    switchCamera,
    getLocalStream,
  } = useMeetLocalMedia({
    meetRtc,
    mediaHolders: callStore
      ? {
          localStream: callStore.localStreamRef,
          screenStream: callStore.screenStreamRef,
          cameraTrack: callStore.cameraTrackRef,
          selectedMicId: callStore.selectedMicIdRef,
          selectedCamId: callStore.selectedCamIdRef,
        }
      : undefined,
    micOn: room.micOn,
    videoOn: room.videoOn,
    screenOn: room.screenOn,
    setMicOn: room.setMicOn,
    setVideoOn: room.setVideoOn,
    setScreenOn: room.setScreenOn,
    setError: room.setError,
    announceMediaPresence,
    cameraBlockedRef,
    micOnRef: room.micOnRef,
    videoOnRef: room.videoOnRef,
    screenOnRef: room.screenOnRef,
  });
  getLocalStreamRef.current = getLocalStream;
  muteMicRef.current = muteMic;
  unmuteMicRef.current = unmuteMic;
  // Mini-player (outside `/meet`) calls the same toggles so mic/camera stay in sync.
  if (callStore) {
    callStore.toggleMicRef.current = toggleMic;
    callStore.toggleVideoRef.current = toggleVideo;
  }

  const announceMediaPresenceEnterInCall = useCallback(() => {
    void announceMediaPresence(room.micOnRef.current, room.videoOnRef.current);
  }, [announceMediaPresence, room.micOnRef, room.videoOnRef]);

  useMeetInboundMediaHints({
    enabled: room.status === "in-call",
    meetRtc,
    peerInboundSampleRef: room.peerInboundSampleRef,
    peerMediaHintRef: room.peerMediaHintRef,
    refreshPeers,
    onEnterInCall: announceMediaPresenceEnterInCall,
  });

  useEffect(() => {
    if (room.status === "in-call") return;
    room.peerDisclosedMediaRef.current.clear();
    room.refreshPeersRef.current();
  }, [room.status, room.peerDisclosedMediaRef, room.refreshPeersRef]);

  useEffect(() => {
    const node = localVideoRef.current;
    if (!node) return;
    const stream = getLocalStream();
    node.srcObject = stream;
  }, [getLocalStream, localVideoRef, room.status, room.videoOn, room.screenOn]);

  return {
    meetRtc,
    operationsRef,
    debugRtc,
    ensureLocalMedia,
    stopLocalMedia,
    getLocalStream,
    localVideoRef,
    screenPreviewStream,
    audioInputs,
    audioOutputs,
    videoInputs,
    selectedMicId,
    selectedCamId,
    toggleMic,
    toggleVideo,
    toggleScreenShare,
    screenMode,
    startScreenShare,
    setScreenOptimize,
    stopScreenShare,
    cameraSendingDisabled,
    lowData,
    setLowData,
    relayBanner,
    relayTiles,
    switchMic,
    switchCamera,
  };
}

export type MeetCallSessionState = ReturnType<typeof useMeetCallSession>;
