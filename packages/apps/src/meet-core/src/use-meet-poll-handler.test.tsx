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

function createPollHandler() {
  const muteMic = vi.fn(() => true);
  const { result } = renderHook(() =>
    useMeetPollHandler({
      selfIdRef: { current: "self-1" },
      statusRef: { current: "in-call" },
      roomCodeRef: { current: "room-1" },
      displayNameRef: { current: "Alex" },
      waitingForAdmissionRef: { current: false },
      rosterRef: { current: new Map() },
      participantRosterDiffReadyRef: { current: true },
      peerNamesRef: { current: new Map() },
      peerDisclosedMediaRef: { current: new Map() },
      refreshPeersRef: { current: () => {} },
      leaveRef: { current: vi.fn() },
      meetRtcRef: { current: null },
      muteMicRef: { current: muteMic },
      setKnockers: vi.fn(),
      setEndedMessage: vi.fn(),
      setStatus: vi.fn(),
      setStartedAt: vi.fn(),
      setWaitingForAdmission: vi.fn(),
      setChatMessages: vi.fn(),
    }),
  );
  return { handlePoll: result.current, muteMic };
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
