/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";
import { useMeetCallSession } from "@/meet-core/src/use-meet-call-session";
import type { UseMeetRtcOptions } from "@/meet-core/src/use-meet-rtc";

let rtcOptions: UseMeetRtcOptions | null = null;

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/meet-core/src/use-meet-poll-handler", () => ({
  useMeetPollHandler: () => async () => {},
}));

vi.mock("@/meet-core/src/use-meet-inbound-media-hints", () => ({
  useMeetInboundMediaHints: () => {},
}));

vi.mock("@/meet-core/src/use-meet-local-media", () => ({
  useMeetLocalMedia: () => ({
    localVideoRef: { current: null },
    screenPreviewStream: null,
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
    selectedMicId: null,
    selectedCamId: null,
    ensureLocalMedia: vi.fn(),
    stopLocalMedia: vi.fn(),
    toggleMic: vi.fn(),
    muteMic: vi.fn(),
    unmuteMic: vi.fn(),
    toggleVideo: vi.fn(),
    toggleScreenShare: vi.fn(),
    switchMic: vi.fn(),
    switchCamera: vi.fn(),
    getLocalStream: () => null,
  }),
}));

vi.mock("@/meet-core/src/use-meet-rtc", () => ({
  useMeetRtc: (options: UseMeetRtcOptions) => {
    rtcOptions = options;
    return {
      join: vi.fn(),
      updateJoinName: vi.fn(),
      retryRoomPeerConnections: vi.fn(),
      leave: vi.fn(),
      replaceAudioTrack: vi.fn(),
      replaceVideoTrack: vi.fn(),
      getPeerConnection: () => null,
      getRemoteStream: () => null,
      getPeerIds: () => [],
      getMyId: () => "self-1",
      getSessionKey: () => null,
      setEncodingPrefs: vi.fn(),
      isCameraSendingDisabled: () => false,
    };
  },
}));

function createRoom(signalingRoster: Map<string, string>): MeetRoomState {
  return {
    status: "in-call",
    statusRef: { current: "in-call" },
    selfIdRef: { current: "self-1" },
    waitingForAdmissionRef: { current: false },
    rosterRef: { current: new Map() },
    signalingRosterRef: { current: signalingRoster },
    peerNamesRef: { current: new Map() },
    peerInboundSampleRef: { current: new Map() },
    peerDisclosedMediaRef: { current: new Map() },
    peerMediaHintRef: { current: new Map() },
    refreshPeersRef: { current: () => {} },
    micOnRef: { current: true },
    videoOnRef: { current: false },
    screenOnRef: { current: false },
    roomCodeRef: { current: "room-1" },
    displayNameRef: { current: "Alex" },
    setPeers: vi.fn(),
    setError: vi.fn(),
    setKnockers: vi.fn(),
    setEndedMessage: vi.fn(),
    setStatus: vi.fn(),
    setStartedAt: vi.fn(),
    setWaitingForAdmission: vi.fn(),
    setChatMessages: vi.fn(),
    setMicOn: vi.fn(),
    setVideoOn: vi.fn(),
    setScreenOn: vi.fn(),
    micOn: true,
    videoOn: false,
    screenOn: false,
  } as unknown as MeetRoomState;
}

function renderCallSession(signalingRoster: Map<string, string>): void {
  renderHook(() =>
    useMeetCallSession({
      room: createRoom(signalingRoster),
      rtc: { stunUrls: "", turnAvailable: false, forceRelay: false },
      isGuestSession: false,
      leaveRef: { current: null },
    }),
  );
}

describe("useMeetCallSession offer gate", () => {
  beforeEach(() => {
    rtcOptions = null;
  });

  it("answers an offer from an admitted roster row", () => {
    renderCallSession(new Map([["host-1", "Admin"]]));

    expect(rtcOptions?.shouldAcceptOffer?.("host-1")).toBe(true);
  });

  it("ignores a knocker's offer even though the server already rejects it", () => {
    renderCallSession(new Map([["knocker-1", "__wgw_knock__:Mallory"]]));

    expect(rtcOptions?.shouldAcceptOffer?.("knocker-1")).toBe(false);
  });

  it("ignores an offer from an id that is not in the roster", () => {
    renderCallSession(new Map([["host-1", "Admin"]]));

    expect(rtcOptions?.shouldAcceptOffer?.("forged-1")).toBe(false);
  });
});
