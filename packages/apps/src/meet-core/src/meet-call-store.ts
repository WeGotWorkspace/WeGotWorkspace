import { syncMeetLocalTrackEnabled } from "@/meet-core/src/meet-local-track-enabled";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetCallStatus, MeetRemotePeer } from "@/meet-core/src/meet-call-types";
import type { MeetMiniPlayerPosition } from "@/meet-core/src/meet-mini-player-position";
import type { MeetChatLine } from "@/meet-core/src/meet-chat-line";
import type { PeerInboundSample } from "@/meet-core/src/meet-inbound-media-hints";
import type { MeetKnocker } from "@/meet-core/src/meet-poll-roster";
import type { MeetRtcSession } from "@/meet-core/src/meet-rtc-session";

type Ref<T> = { current: T };

type Updater<T> = T | ((prev: T) => T);

/**
 * Transport-neutral view of the call: active call, participants, local track
 * state, and status. Deliberately no peer-connection concepts — a later SFU
 * transport can feed the same shape.
 */
export type MeetCallSnapshot = {
  status: MeetCallStatus;
  error: string | null;
  roomCode: string | null;
  selfId: string | null;
  displayName: string;
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  startedAt: number | null;
  elapsedSeconds: number;
  participants: MeetRemotePeer[];
  chatMessages: MeetChatLine[];
  waitingForAdmission: boolean;
  knockers: MeetKnocker[];
  endedMessage: string | null;
  /** Another browser tab reports an active call (BroadcastChannel signal). */
  remoteCallActive: boolean;
  /**
   * The Meet chat workspace is mounted but the live call's channel is not on
   * screen (another channel selected, or Meet unmounted while the call
   * continues). Lets the mini-player show inside `/meet`; legacy shells never
   * set this, so their full-screen call keeps hiding it.
   */
  callUiParked: boolean;
  /**
   * Display label for the live call's channel/meeting/DM (mini-player title).
   * Null for ad-hoc/legacy rooms — the mini-player falls back to "Meet".
   */
  callLabel: string | null;
  /**
   * Workspace selection key for the live call (`chat-…`, `dm:{peer}`). Survives
   * Meet unmount so returning via the app switcher can restore the in-call view.
   */
  liveCallChannelId: string | null;
  /** Channel kind for `liveCallChannelId` (meeting vs channel). Unused for DMs. */
  liveCallChannelKind: string | null;
  /**
   * Compact vs expanded chrome for the live call. Survives Meet remounts so
   * returning from another app does not force the split stage. Null until the
   * user joins; cleared on hang-up.
   */
  callUiLayout: MeetCallStageLayout | null;
  /**
   * Viewport `left`/`top` for the floating mini-player after the user drags it.
   * Null keeps the default bottom-right dock. Survives Meet remounts; cleared on hang-up.
   */
  miniPlayerPosition: MeetMiniPlayerPosition | null;
};

function createInitialSnapshot(): MeetCallSnapshot {
  return {
    status: "idle",
    error: null,
    roomCode: null,
    selfId: null,
    displayName: "",
    micOn: true,
    videoOn: true,
    screenOn: false,
    startedAt: null,
    elapsedSeconds: 0,
    participants: [],
    chatMessages: [],
    waitingForAdmission: false,
    knockers: [],
    endedMessage: null,
    remoteCallActive: false,
    callUiParked: false,
    callLabel: null,
    liveCallChannelId: null,
    liveCallChannelKind: null,
    callUiLayout: null,
    miniPlayerPosition: null,
  };
}

/**
 * Suite-level Meet call store. Lives above the router (see `MeetCallProvider`), so an
 * active call survives route unmounts. Holds:
 *
 * - an observable transport-neutral snapshot (`subscribe`/`getSnapshot`, compatible
 *   with `useSyncExternalStore`);
 * - ref mirrors of snapshot fields for callback closures that outlive a route mount;
 * - persistent session-scoped holders (RTC session, local media tracks, roster maps)
 *   that the meet hooks adopt instead of per-mount refs when a store is provided.
 *
 * In mock/Storybook usage no provider exists and each mount creates its own store,
 * which preserves the previous leave-on-unmount behavior.
 */
export class MeetCallStore {
  private snapshot: MeetCallSnapshot = createInitialSnapshot();

  private readonly listeners = new Set<() => void>();

  private displayNameInitialized = false;

  private displayNameUserEdited = false;

  // Ref mirrors, updated synchronously by the setters below.
  readonly statusRef: Ref<MeetCallStatus> = { current: "idle" };

  readonly selfIdRef: Ref<string | null> = { current: null };

  readonly roomCodeRef: Ref<string | null> = { current: null };

  readonly displayNameRef: Ref<string> = { current: "" };

  readonly waitingForAdmissionRef: Ref<boolean> = { current: false };

  readonly micOnRef: Ref<boolean> = { current: true };

  readonly videoOnRef: Ref<boolean> = { current: true };

  readonly screenOnRef: Ref<boolean> = { current: false };

  readonly remoteCallActiveRef: Ref<boolean> = { current: false };

  // Session-scoped mutable state (not observable; survives route remounts).
  readonly participantRosterDiffReadyRef: Ref<boolean> = { current: false };

  readonly rosterRef: Ref<Map<string, string>> = { current: new Map() };

  readonly peerInboundSampleRef: Ref<Map<string, PeerInboundSample>> = { current: new Map() };

  readonly peerMediaHintRef: Ref<Map<string, { camera: boolean; mic: boolean }>> = {
    current: new Map(),
  };

  readonly peerDisclosedMediaRef: Ref<
    Map<string, { mic: boolean; camera: boolean; screen?: boolean }>
  > = { current: new Map() };

  readonly peerNamesRef: Ref<Map<string, string>> = { current: new Map() };

  readonly refreshPeersRef: Ref<() => void> = { current: () => {} };

  // Persistent transport + local media holders adopted by the meet hooks.
  readonly rtcSessionRef: Ref<MeetRtcSession | null> = { current: null };

  readonly localStreamRef: Ref<MediaStream | null> = { current: null };

  readonly screenStreamRef: Ref<MediaStream | null> = { current: null };

  readonly cameraTrackRef: Ref<MediaStreamTrack | null> = { current: null };

  readonly selectedMicIdRef: Ref<string | null> = { current: null };

  readonly selectedCamIdRef: Ref<string | null> = { current: null };

  /** Headless hang-up entry point (used by the mini-player outside `/meet`). */
  readonly leaveRef: Ref<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)> = {
    current: null,
  };

  /**
   * Registered by the Meet chat workspace: selects the live call's channel.
   * Lets the mini-player's "return to call" work while already on `/meet`
   * (parked call), where navigation alone would not change the selection.
   */
  readonly focusCallChannelRef: Ref<null | (() => void)> = { current: null };

  /**
   * Headless mic/camera toggles for the mini-player. Same callbacks as full Meet
   * (`useMeetLocalMedia`); both UIs read `micOn`/`videoOn` from this store.
   */
  readonly toggleMicRef: Ref<null | (() => void)> = { current: null };

  readonly toggleVideoRef: Ref<null | (() => void)> = { current: null };

  /** Serializes join/requestJoin across remounts so a second peer is not minted. */
  readonly joinInFlightRef: Ref<Promise<void> | null> = { current: null };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MeetCallSnapshot => this.snapshot;

  /** First-mount default; a user-edited display name wins across remounts. */
  initializeDisplayName(name: string): void {
    if (this.displayNameInitialized || !name.trim()) return;
    this.displayNameInitialized = true;
    // Silent write: runs during render of the first consumer, before anyone subscribed.
    this.snapshot = { ...this.snapshot, displayName: name };
    this.displayNameRef.current = name;
  }

  /**
   * Identity-derived refresh once the session/bootstrap resolves. The suite-level
   * store outlives the bootstrap remount, so the first-mount default may be the
   * loading placeholder ("Guest"); overwrite it here — but never a name the user
   * typed themselves.
   */
  refreshDisplayName(name: string): void {
    if (this.displayNameUserEdited || !name.trim()) return;
    this.displayNameInitialized = true;
    this.set("displayName", name, this.displayNameRef);
  }

  setStatus = (value: Updater<MeetCallStatus>): void => {
    this.set("status", value, this.statusRef);
    if (this.statusRef.current === "idle" || this.statusRef.current === "failed") {
      this.clearLiveCallResume();
    }
  };

  setError = (value: Updater<string | null>): void => {
    this.set("error", value);
  };

  setRoomCode = (value: Updater<string | null>): void => {
    this.set("roomCode", value, this.roomCodeRef);
  };

  setSelfId = (value: Updater<string | null>): void => {
    this.set("selfId", value, this.selfIdRef);
  };

  setDisplayName = (value: Updater<string>): void => {
    this.displayNameInitialized = true;
    this.displayNameUserEdited = true;
    this.set("displayName", value, this.displayNameRef);
  };

  setMicOn = (value: Updater<boolean>): void => {
    this.set("micOn", value, this.micOnRef);
    syncMeetLocalTrackEnabled(this.localStreamRef.current, {
      mic: this.micOnRef.current,
      video: this.videoOnRef.current,
    });
  };

  setVideoOn = (value: Updater<boolean>): void => {
    this.set("videoOn", value, this.videoOnRef);
    syncMeetLocalTrackEnabled(this.localStreamRef.current, {
      mic: this.micOnRef.current,
      video: this.videoOnRef.current,
    });
  };

  setScreenOn = (value: Updater<boolean>): void => {
    this.set("screenOn", value, this.screenOnRef);
  };

  setStartedAt = (value: Updater<number | null>): void => {
    this.set("startedAt", value);
  };

  setElapsedSeconds = (value: Updater<number>): void => {
    this.set("elapsedSeconds", value);
  };

  setPeers = (value: Updater<MeetRemotePeer[]>): void => {
    this.set("participants", value);
  };

  setChatMessages = (value: Updater<MeetChatLine[]>): void => {
    this.set("chatMessages", value);
  };

  setWaitingForAdmission = (value: Updater<boolean>): void => {
    this.set("waitingForAdmission", value, this.waitingForAdmissionRef);
  };

  setKnockers = (value: Updater<MeetKnocker[]>): void => {
    this.set("knockers", value);
  };

  setEndedMessage = (value: Updater<string | null>): void => {
    this.set("endedMessage", value);
  };

  setRemoteCallActive = (value: Updater<boolean>): void => {
    this.set("remoteCallActive", value, this.remoteCallActiveRef);
  };

  setCallUiParked = (value: Updater<boolean>): void => {
    this.set("callUiParked", value);
  };

  setCallLabel = (value: Updater<string | null>): void => {
    this.set("callLabel", value);
  };

  setLiveCallChannelId = (value: Updater<string | null>): void => {
    this.set("liveCallChannelId", value);
  };

  setLiveCallChannelKind = (value: Updater<string | null>): void => {
    this.set("liveCallChannelKind", value);
  };

  setCallUiLayout = (value: Updater<MeetCallStageLayout | null>): void => {
    this.set("callUiLayout", value);
  };

  setMiniPlayerPosition = (value: Updater<MeetMiniPlayerPosition | null>): void => {
    const previous = this.snapshot.miniPlayerPosition;
    const next =
      typeof value === "function"
        ? (value as (prev: MeetMiniPlayerPosition | null) => MeetMiniPlayerPosition | null)(
            previous,
          )
        : value;
    if (previous?.x === next?.x && previous?.y === next?.y) return;
    this.set("miniPlayerPosition", next);
  };

  /** Hang-up / failure: drop resume keys so a later `/meet` visit is not hijacked. */
  clearLiveCallResume = (): void => {
    this.setLiveCallChannelId(null);
    this.setLiveCallChannelKind(null);
    this.setCallLabel(null);
    this.setCallUiParked(false);
    this.setCallUiLayout(null);
    this.setMiniPlayerPosition(null);
  };

  resetPeerMaps = (): void => {
    this.rosterRef.current = new Map();
    this.peerNamesRef.current = new Map();
    this.participantRosterDiffReadyRef.current = false;
    this.peerDisclosedMediaRef.current.clear();
  };

  resetIdleMediaDefaults = (): void => {
    this.setScreenOn(false);
    this.setMicOn(true);
    this.setVideoOn(true);
  };

  private set<K extends keyof MeetCallSnapshot>(
    key: K,
    value: Updater<MeetCallSnapshot[K]>,
    ref?: Ref<MeetCallSnapshot[K]>,
  ): void {
    const previous = this.snapshot[key];
    const next =
      typeof value === "function"
        ? (value as (prev: MeetCallSnapshot[K]) => MeetCallSnapshot[K])(previous)
        : value;
    if (Object.is(previous, next)) return;
    if (ref) ref.current = next;
    this.snapshot = { ...this.snapshot, [key]: next };
    for (const listener of this.listeners) listener();
  }
}

export function createMeetCallStore(): MeetCallStore {
  return new MeetCallStore();
}
