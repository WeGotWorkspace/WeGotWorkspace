/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import { useMeetPollHandler } from "@/meet-core/src/use-meet-poll-handler";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
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
  const setWaitingForAdmission = overrides.setWaitingForAdmission ?? vi.fn();
  const setKnockers = overrides.setKnockers ?? vi.fn();
  const setStatus = overrides.setStatus ?? vi.fn();
  const setStartedAt = overrides.setStartedAt ?? vi.fn();
  const updateJoinName = overrides.updateJoinName ?? vi.fn().mockResolvedValue(undefined);
  const retryRoomPeerConnections = vi.fn();
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
      setKnockers,
      setEndedMessage: vi.fn(),
      setStatus,
      setStartedAt,
      setWaitingForAdmission,
      setChatMessages: vi.fn(),
    }),
  );
  return {
    handlePoll: result.current,
    muteMic,
    setWaitingForAdmission,
    setStatus,
    setKnockers,
    updateJoinName,
    retryRoomPeerConnections,
  };
}

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
