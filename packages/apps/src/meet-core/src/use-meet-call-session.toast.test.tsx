/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";
import { useMeetCallSession } from "@/meet-core/src/use-meet-call-session";
import type { UseMeetRtcOptions } from "@/meet-core/src/use-meet-rtc";

const toastApi = {
  show: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  dismiss: vi.fn(),
};

let rtcOptions: UseMeetRtcOptions | null = null;

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
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
    };
  },
}));

function createRoom(): MeetRoomState {
  return {
    status: "in-call",
    statusRef: { current: "in-call" },
    selfIdRef: { current: "self-1" },
    waitingForAdmissionRef: { current: false },
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

describe("useMeetCallSession leave toast", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    rtcOptions = null;
  });

  it("toasts through useAppToast when another peer leaves the call", () => {
    const room = createRoom();
    renderHook(() =>
      useMeetCallSession({
        room,
        rtc: {
          stunUrls: "",
          turnUrls: "",
          turnUsername: "",
          turnPassword: "",
          forceRelay: false,
        },
        isGuestSession: false,
        leaveRef: { current: null },
      }),
    );

    rtcOptions?.onPeerRemoved("host-1", "Admin", "bye");

    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.participantLeft("Admin"), {
      severity: "info",
    });
  });

  it("does not toast when the local peer is removed", () => {
    const room = createRoom();
    renderHook(() =>
      useMeetCallSession({
        room,
        rtc: {
          stunUrls: "",
          turnUrls: "",
          turnUsername: "",
          turnPassword: "",
          forceRelay: false,
        },
        isGuestSession: false,
        leaveRef: { current: null },
      }),
    );

    rtcOptions?.onPeerRemoved("self-1", "Alex", "bye");

    expect(toastApi.show).not.toHaveBeenCalled();
  });
});
