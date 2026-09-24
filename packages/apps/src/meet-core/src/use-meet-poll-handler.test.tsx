/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { buildMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import type { MeetKnocker } from "@/meet-core/src/meet-poll-roster";
import { useMeetPollHandler } from "@/meet-core/src/use-meet-poll-handler";

type CallStatus = "idle" | "preparing" | "waiting" | "in-call" | "failed";

const toastApi = {
  show: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

function createPollHandler(
  overrides: {
    waitingForAdmissionRef?: { current: boolean };
    setWaitingForAdmission?: ReturnType<typeof vi.fn>;
    setStatus?: ReturnType<typeof vi.fn>;
    setStartedAt?: ReturnType<typeof vi.fn>;
    setKnockers?: ReturnType<typeof vi.fn>;
    updateJoinName?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const muteMic = vi.fn(() => true);
  const unmuteMic = vi.fn(() => true);
  const setWaitingForAdmission = (overrides.setWaitingForAdmission ?? vi.fn()) as Dispatch<
    SetStateAction<boolean>
  >;
  const setKnockers = (overrides.setKnockers ?? vi.fn()) as Dispatch<SetStateAction<MeetKnocker[]>>;
  const setStatus = (overrides.setStatus ?? vi.fn()) as Dispatch<SetStateAction<CallStatus>>;
  const setStartedAt = (overrides.setStartedAt ?? vi.fn()) as Dispatch<
    SetStateAction<number | null>
  >;
  const updateJoinName = overrides.updateJoinName ?? vi.fn().mockResolvedValue(undefined);
  const retryRoomPeerConnections = vi.fn();
  const setEndedMessage = vi.fn();
  const { result } = renderHook(() =>
    useMeetPollHandler({
      selfIdRef: { current: "self-1" },
      statusRef: { current: "in-call" },
      roomCodeRef: { current: "room-1" },
      displayNameRef: { current: "Alex" },
      waitingForAdmissionRef: overrides.waitingForAdmissionRef ?? { current: false },
      rosterRef: { current: new Map() },
      participantRosterDiffReadyRef: { current: true },
      peerNamesRef: { current: new Map() },
      peerDisclosedMediaRef: { current: new Map() },
      refreshPeersRef: { current: () => {} },
      leaveRef: { current: vi.fn() },
      meetRtcRef: { current: { updateJoinName, retryRoomPeerConnections } as never },
      muteMicRef: { current: muteMic },
      unmuteMicRef: { current: unmuteMic },
      setKnockers,
      setEndedMessage,
      setStatus,
      setStartedAt,
      setWaitingForAdmission,
      setChatMessages: vi.fn(),
    }),
  );
  return {
    handlePoll: result.current,
    muteMic,
    unmuteMic,
    setWaitingForAdmission,
    setStatus,
    setEndedMessage,
    setKnockers,
    updateJoinName,
    retryRoomPeerConnections,
  };
}

beforeEach(() => {
  toastApi.show.mockClear();
  toastApi.showSuccess.mockClear();
  toastApi.showError.mockClear();
});

describe("useMeetPollHandler mute", () => {
  it("mutes the local mic when a mute control targets this peer", async () => {
    const { handlePoll, muteMic } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "mute", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(muteMic).toHaveBeenCalledTimes(1);
  });

  it("ignores mute controls aimed at someone else", async () => {
    const { handlePoll, muteMic } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "mute", peerId: "peer-other" }),
          },
        },
      ],
    });

    expect(muteMic).not.toHaveBeenCalled();
  });

  it("unmutes the local mic when an unmute control targets this peer", async () => {
    const { handlePoll, unmuteMic } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "unmute", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(unmuteMic).toHaveBeenCalledTimes(1);
  });

  it("ignores unmute controls aimed at someone else", async () => {
    const { handlePoll, unmuteMic } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "unmute", peerId: "peer-other" }),
          },
        },
      ],
    });

    expect(unmuteMic).not.toHaveBeenCalled();
  });

  it("toasts through useAppToast when this peer is unmuted", async () => {
    const { handlePoll } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "unmute", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.unmutedByHost, { severity: "info" });
  });
});

describe("useMeetPollHandler admit", () => {
  it("drops waiting chrome before rename-rejoin when this peer is admitted", async () => {
    const order: string[] = [];
    const updateJoinName = vi.fn(async () => {
      order.push("rejoin");
    });
    const setWaitingForAdmission = vi.fn((value: boolean) => {
      order.push(`waiting:${String(value)}`);
    });
    const { handlePoll, retryRoomPeerConnections } = createPollHandler({
      waitingForAdmissionRef: { current: true },
      setWaitingForAdmission,
      updateJoinName,
    });

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(order[0]).toBe("waiting:false");
    expect(order.indexOf("waiting:false")).toBeLessThan(order.indexOf("rejoin"));
    expect(updateJoinName).toHaveBeenCalledWith("Alex");
    expect(retryRoomPeerConnections).toHaveBeenCalledTimes(1);
  });

  it("still leaves the wait UI when rename-rejoin throws", async () => {
    const setWaitingForAdmission = vi.fn();
    const setStatus = vi.fn();
    const { handlePoll, retryRoomPeerConnections } = createPollHandler({
      waitingForAdmissionRef: { current: true },
      setWaitingForAdmission,
      setStatus,
      updateJoinName: vi.fn().mockRejectedValue(new Error("knock_required")),
    });

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(setWaitingForAdmission).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith("in-call");
    expect(retryRoomPeerConnections).toHaveBeenCalledTimes(1);
  });
});

describe("useMeetPollHandler knockers", () => {
  it("clears leftover knocker rows once the roster has no knock names", async () => {
    const setKnockers = vi.fn();
    const { handlePoll } = createPollHandler({ setKnockers });

    await handlePoll({
      peers: [
        { id: "host-1", name: "Admin" },
        { id: "guest-1", name: "Ada" },
      ],
      messages: [],
    });

    const last = setKnockers.mock.calls.at(-1)?.[0] as (
      prev: { id: string; name: string }[],
    ) => { id: string; name: string }[];
    expect(last([{ id: "guest-1", name: "Ada" }])).toEqual([]);
  });
});

describe("useMeetPollHandler call toasts", () => {
  it("toasts through useAppToast when a participant joins", async () => {
    const { handlePoll } = createPollHandler();

    await handlePoll({
      peers: [
        { id: "self-1", name: "Alex" },
        { id: "host-1", name: "Admin" },
      ],
      messages: [],
    });

    expect(toastApi.showSuccess).toHaveBeenCalledWith(meetLabels.participantJoined("Admin"));
  });

  it("toasts through useAppToast when the host ends the call", async () => {
    const { handlePoll, setEndedMessage } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "end", by: "Admin" }),
          },
        },
      ],
    });

    expect(setEndedMessage).toHaveBeenCalledWith(meetLabels.callEndedBy("Admin"));
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.callEndedBy("Admin"), {
      severity: "info",
    });
  });

  it("toasts through useAppToast when this peer is muted", async () => {
    const { handlePoll } = createPollHandler();

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "mute", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.mutedByHost, { severity: "info" });
  });

  it("toasts through useAppToast when this peer is admitted", async () => {
    const { handlePoll } = createPollHandler({
      waitingForAdmissionRef: { current: true },
    });

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(toastApi.showSuccess).toHaveBeenCalledWith(meetLabels.youWereLetIn);
  });

  it("toasts through useAppToast when this peer is denied", async () => {
    const { handlePoll } = createPollHandler({
      waitingForAdmissionRef: { current: true },
    });

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: {
            text: buildMeetControlMessage({ kind: "deny", peerId: "self-1" }),
          },
        },
      ],
    });

    expect(toastApi.showError).toHaveBeenCalledWith(meetLabels.joinDenied);
  });
});
