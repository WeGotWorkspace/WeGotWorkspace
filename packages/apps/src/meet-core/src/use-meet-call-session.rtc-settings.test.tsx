/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetAPIOperations } from "@/meet-core/src/meet-types";
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

function createRoom(): MeetRoomState {
  return {
    status: "in-call",
    statusRef: { current: "in-call" },
    selfIdRef: { current: "self-1" },
    waitingForAdmissionRef: { current: false },
    rosterRef: { current: new Map() },
    signalingRosterRef: { current: new Map() },
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

const fallbackRtc = {
  stunUrls: "",
  turnAvailable: false,
  forceRelay: false,
  source: "fallback" as const,
};

function renderSession(operations?: MeetAPIOperations): void {
  const room = createRoom();
  renderHook(() =>
    useMeetCallSession({
      room,
      rtc: fallbackRtc,
      operations,
      isGuestSession: true,
      leaveRef: { current: null },
    }),
  );
}

describe("useMeetCallSession rtc settings", () => {
  beforeEach(() => {
    rtcOptions = null;
  });

  it("forwards the room code and session key to guest operations", async () => {
    const read = vi.fn(async () => ({
      stunUrls: "stun:room.example:3478",
      turnAvailable: true,
      forceRelay: false,
      source: "server" as const,
    }));
    renderSession({ rtcSettings: read } as unknown as MeetAPIOperations);

    await rtcOptions?.refreshRtcSettings?.({ sessionKey: "sk-1" });

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ room: "room-1", sessionKey: "sk-1" });
  });

  it("resolves null when operations have no rtcSettings hook", async () => {
    const read = vi.fn();
    renderSession({} as MeetAPIOperations);

    await expect(rtcOptions?.refreshRtcSettings?.({ sessionKey: "sk-1" })).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("re-renders with the settings a refresh applied", () => {
    renderSession();

    act(() => {
      rtcOptions?.onRtcSettings?.({
        stunUrls: "stun:x:3478",
        turnAvailable: true,
        forceRelay: false,
      });
    });

    expect(rtcOptions?.rtcSettings).toMatchObject({
      stunUrls: "stun:x:3478",
      source: "server",
    });
  });
});
