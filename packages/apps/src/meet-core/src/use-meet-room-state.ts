import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createMeetCallStore, type MeetCallStore } from "@/meet-core/src/meet-call-store";

export type UseMeetRoomStateArgs = {
  defaultDisplayName: string;
  sessionDisplayName: string;
  /**
   * False while the live bootstrap is still loading and `defaultDisplayName` /
   * `sessionDisplayName` are placeholders. Blocks the identity refresh so the
   * suite-level store never adopts a placeholder over the real session identity.
   */
  identityReady?: boolean;
  buildCallLink?: (roomCode: string) => string;
  onRoomChange?: (roomCode: string | null) => void;
  /** Suite-level store (live app). Absent in mock/Storybook: state stays per-mount. */
  callStore?: MeetCallStore;
};

/**
 * View over the meet call store. All call state lives in `MeetCallStore` so an
 * active call survives route unmounts when the suite-level provider supplies the
 * store; without one, a store is created per mount (previous behavior).
 */
export function useMeetRoomState({
  defaultDisplayName,
  sessionDisplayName,
  identityReady = true,
  buildCallLink,
  onRoomChange,
  callStore,
}: UseMeetRoomStateArgs) {
  const localStoreRef = useRef<MeetCallStore | null>(null);
  if (!callStore && !localStoreRef.current) {
    localStoreRef.current = createMeetCallStore();
  }
  const store = callStore ?? localStoreRef.current!;

  // Silent, idempotent write — safe during render (see MeetCallStore).
  store.initializeDisplayName(defaultDisplayName || sessionDisplayName || "Guest");

  // The suite-level store may have latched a pre-bootstrap placeholder ("Guest")
  // above; once the real session identity is known, refresh it (user edits win).
  useEffect(() => {
    if (!identityReady) return;
    store.refreshDisplayName(defaultDisplayName || sessionDisplayName || "Guest");
  }, [defaultDisplayName, identityReady, sessionDisplayName, store]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const {
    status,
    error,
    roomCode,
    selfId,
    displayName,
    micOn,
    videoOn,
    screenOn,
    startedAt,
    participants: peers,
    chatMessages,
    elapsedSeconds,
    waitingForAdmission,
    knockers,
    endedMessage,
    remoteCallActive,
  } = snapshot;

  useEffect(() => {
    if (!startedAt) {
      store.setElapsedSeconds(0);
      return;
    }
    const id = window.setInterval(() => {
      store.setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, store]);

  const callLink = useMemo(() => {
    if (!roomCode) return "";
    if (buildCallLink) return buildCallLink(roomCode);
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    if (/\/meet\/guest\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/meet\/guest\/?$/, "/meet/guest");
    } else if (/\/meet\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/meet\/?$/, "/meet/guest");
    } else {
      url.pathname = "/meet/guest";
    }
    url.searchParams.set("room", roomCode);
    return url.toString();
  }, [buildCallLink, roomCode]);

  useEffect(() => {
    onRoomChange?.(roomCode);
  }, [onRoomChange, roomCode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!roomCode) return;
    const next = new URL(window.location.href);
    next.searchParams.set("room", roomCode);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextUrl = `${next.pathname}${next.search}${next.hash}`;
    if (currentUrl !== nextUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [roomCode]);

  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsedSeconds / 3600);
    const m = Math.floor((elapsedSeconds % 3600) / 60);
    const s = elapsedSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }, [elapsedSeconds]);

  return {
    status,
    setStatus: store.setStatus,
    error,
    setError: store.setError,
    roomCode,
    setRoomCode: store.setRoomCode,
    selfId,
    setSelfId: store.setSelfId,
    displayName,
    setDisplayName: store.setDisplayName,
    micOn,
    setMicOn: store.setMicOn,
    videoOn,
    setVideoOn: store.setVideoOn,
    screenOn,
    setScreenOn: store.setScreenOn,
    startedAt,
    setStartedAt: store.setStartedAt,
    peers,
    setPeers: store.setPeers,
    chatMessages,
    setChatMessages: store.setChatMessages,
    elapsedSeconds,
    setElapsedSeconds: store.setElapsedSeconds,
    waitingForAdmission,
    setWaitingForAdmission: store.setWaitingForAdmission,
    knockers,
    setKnockers: store.setKnockers,
    endedMessage,
    setEndedMessage: store.setEndedMessage,
    remoteCallActive,
    remoteCallActiveRef: store.remoteCallActiveRef,
    participantRosterDiffReadyRef: store.participantRosterDiffReadyRef,
    selfIdRef: store.selfIdRef,
    roomCodeRef: store.roomCodeRef,
    statusRef: store.statusRef,
    displayNameRef: store.displayNameRef,
    waitingForAdmissionRef: store.waitingForAdmissionRef,
    rosterRef: store.rosterRef,
    peerInboundSampleRef: store.peerInboundSampleRef,
    peerMediaHintRef: store.peerMediaHintRef,
    peerDisclosedMediaRef: store.peerDisclosedMediaRef,
    peerNamesRef: store.peerNamesRef,
    micOnRef: store.micOnRef,
    videoOnRef: store.videoOnRef,
    screenOnRef: store.screenOnRef,
    refreshPeersRef: store.refreshPeersRef,
    callLink,
    elapsedLabel,
    inCall: status === "in-call" || status === "preparing",
    resetPeerMaps: store.resetPeerMaps,
    resetIdleMediaDefaults: store.resetIdleMediaDefaults,
  };
}

export type MeetRoomState = ReturnType<typeof useMeetRoomState>;
