/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetChatLine } from "@/meet-core/src/meet-chat-line";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { buildMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import type { MeetKnocker } from "@/meet-core/src/meet-poll-roster";
import { shouldAcceptMeetOffer } from "@/meet-core/src/meet-rtc-peers";
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

const accountHost = { id: "host-1", name: "Admin", user: "admin" };

/** Server stamp from a privileged control that passed authority. */
function stamped(text: string): { text: string; host: true } {
  return { text, host: true };
}

function createPollHandler(
  overrides: {
    waitingForAdmissionRef?: { current: boolean };
    signalingRosterRef?: { current: Map<string, string> };
    setWaitingForAdmission?: ReturnType<typeof vi.fn>;
    setStatus?: ReturnType<typeof vi.fn>;
    setStartedAt?: ReturnType<typeof vi.fn>;
    setKnockers?: ReturnType<typeof vi.fn>;
    setChatMessages?: ReturnType<typeof vi.fn>;
    updateJoinName?: ReturnType<typeof vi.fn>;
    viewerSeesAccounts?: boolean;
    leave?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const muteMic = vi.fn(() => true);
  const leave = overrides.leave ?? vi.fn();
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
  const setChatMessages = (overrides.setChatMessages ?? vi.fn()) as Dispatch<
    SetStateAction<MeetChatLine[]>
  >;
  const { result } = renderHook(() =>
    useMeetPollHandler({
      selfIdRef: { current: "self-1" },
      statusRef: { current: "in-call" },
      roomCodeRef: { current: "room-1" },
      displayNameRef: { current: "Alex" },
      waitingForAdmissionRef: overrides.waitingForAdmissionRef ?? { current: false },
      rosterRef: { current: new Map() },
      signalingRosterRef: overrides.signalingRosterRef ?? { current: new Map() },
      participantRosterDiffReadyRef: { current: true },
      peerNamesRef: { current: new Map() },
      peerDisclosedMediaRef: { current: new Map() },
      refreshPeersRef: { current: () => {} },
      leaveRef: {
        current: leave as (opts?: { preserveEndedMessage?: boolean }) => Promise<void>,
      },
      meetRtcRef: { current: { updateJoinName, retryRoomPeerConnections } as never },
      muteMicRef: { current: muteMic },
      viewerSeesAccounts: overrides.viewerSeesAccounts ?? true,
      setKnockers,
      setEndedMessage,
      setStatus,
      setStartedAt,
      setWaitingForAdmission,
      setChatMessages,
    }),
  );
  return {
    handlePoll: result.current,
    muteMic,
    leave,
    setWaitingForAdmission,
    setStatus,
    setEndedMessage,
    setKnockers,
    setChatMessages,
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "mute", peerId: "self-1" })),
        },
      ],
    });

    expect(muteMic).toHaveBeenCalledTimes(1);
  });

  it("ignores mute controls aimed at someone else", async () => {
    const { handlePoll, muteMic } = createPollHandler();

    await handlePoll({
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "mute", peerId: "peer-other" })),
        },
      ],
    });

    expect(muteMic).not.toHaveBeenCalled();
  });

  it("does not force the local mic on for an unmute control", async () => {
    const { handlePoll, muteMic } = createPollHandler();

    await handlePoll({
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "unmute", peerId: "self-1" })),
        },
      ],
    });

    expect(muteMic).not.toHaveBeenCalled();
    expect(toastApi.show).not.toHaveBeenCalled();
  });
});

describe("useMeetPollHandler host control sender", () => {
  it("ignores end, mute, admit, and deny from a roster entry with no account", async () => {
    const leave = vi.fn();
    const setWaitingForAdmission = vi.fn();
    const { handlePoll, muteMic, setEndedMessage } = createPollHandler({
      waitingForAdmissionRef: { current: true },
      setWaitingForAdmission,
      leave,
    });

    await handlePoll({
      peers: [{ id: "guest-1", name: "Visitor" }],
      messages: [
        {
          from: "guest-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "mute", peerId: "self-1" }) },
        },
        {
          from: "guest-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "unmute", peerId: "self-1" }) },
        },
        {
          from: "guest-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "end", by: "Visitor" }) },
        },
        {
          from: "guest-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }) },
        },
        {
          from: "guest-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "deny", peerId: "self-1" }) },
        },
      ],
    });

    expect(muteMic).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
    expect(setWaitingForAdmission).not.toHaveBeenCalled();
    expect(setEndedMessage).not.toHaveBeenCalled();
    expect(toastApi.show).not.toHaveBeenCalled();
    expect(toastApi.showError).not.toHaveBeenCalled();
  });

  it("still applies admit for a guest viewer, whose roster hides account names", async () => {
    const setWaitingForAdmission = vi.fn();
    const { handlePoll } = createPollHandler({
      viewerSeesAccounts: false,
      waitingForAdmissionRef: { current: true },
      setWaitingForAdmission,
    });

    await handlePoll({
      peers: [{ id: "host-1", name: "Admin" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: { text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }) },
        },
      ],
    });

    expect(setWaitingForAdmission).toHaveBeenCalledWith(false);
    expect(toastApi.showSuccess).toHaveBeenCalledWith(meetLabels.youWereLetIn);
  });

  it("still leaves when a stamped end arrives after the host has left the roster", async () => {
    const leave = vi.fn();
    const { handlePoll, setEndedMessage } = createPollHandler({ leave });

    await handlePoll({
      peers: [accountHost, { id: "self-1", name: "Alex", user: "alex" }],
      messages: [],
    });

    await handlePoll({
      peers: [{ id: "self-1", name: "Alex", user: "alex" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "end", by: "Admin" })),
        },
      ],
    });

    expect(setEndedMessage).toHaveBeenCalledWith(meetLabels.callEndedBy("Admin"));
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.callEndedBy("Admin"), {
      severity: "info",
    });
    expect(leave).toHaveBeenCalledWith({ preserveEndedMessage: true });
  });

  it("still mutes when a stamped mute arrives after the host has left the roster", async () => {
    const { handlePoll, muteMic } = createPollHandler();

    await handlePoll({
      peers: [accountHost],
      messages: [],
    });

    await handlePoll({
      peers: [{ id: "self-1", name: "Alex", user: "alex" }],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "mute", peerId: "self-1" })),
        },
      ],
    });

    expect(muteMic).toHaveBeenCalledTimes(1);
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "admit", peerId: "self-1" })),
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "admit", peerId: "self-1" })),
        },
      ],
    });

    expect(setWaitingForAdmission).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith("in-call");
    expect(retryRoomPeerConnections).toHaveBeenCalledTimes(1);
  });
});

function appliedChatLines(setChatMessages: ReturnType<typeof vi.fn>): MeetChatLine[] {
  const update = setChatMessages.mock.calls.at(-1)?.[0] as
    ((prev: MeetChatLine[]) => MeetChatLine[]) | undefined;
  return update ? update([]) : [];
}

describe("useMeetPollHandler chat", () => {
  it("keeps a guest room line under a new id", async () => {
    const setChatMessages = vi.fn();
    const { handlePoll } = createPollHandler({ setChatMessages });

    await handlePoll({
      peers: [{ id: "peer-2", name: "Ada" }],
      messages: [{ from: "peer-2", type: "chat", payload: { text: "from guest" } }],
    });

    const [line] = appliedChatLines(setChatMessages);
    expect(line).toMatchObject({
      fromPeerId: "peer-2",
      fromName: "Ada",
      body: "from guest",
      isSelf: false,
    });
    expect(line?.id).toMatch(/^peer-2-/);
  });

  it("marks a channel echo without using the saved id as the line id", async () => {
    const setChatMessages = vi.fn();
    const { handlePoll } = createPollHandler({ setChatMessages });

    await handlePoll({
      peers: [{ id: "peer-2", name: "Ada" }],
      messages: [
        {
          from: "peer-2",
          type: "chat",
          payload: { text: "__wgw_meet_channel_chat__:saved-1\nhello" },
        },
      ],
    });

    const [line] = appliedChatLines(setChatMessages);
    expect(line).toMatchObject({
      fromPeerId: "peer-2",
      fromName: "Ada",
      body: "hello",
      isSelf: false,
      channelMessageId: "saved-1",
    });
    expect(line?.id).toMatch(/^peer-2-/);
    expect(line?.id).not.toBe("saved-1");
  });
});

describe("useMeetPollHandler offer gate", () => {
  it("records the knock rows the offer gate needs", async () => {
    const signalingRosterRef = { current: new Map<string, string>() };
    const { handlePoll } = createPollHandler({ signalingRosterRef });

    await handlePoll({
      peers: [
        { id: "host-1", name: "Admin" },
        { id: "knocker-1", name: "__wgw_knock__:Mallory" },
      ],
      messages: [],
    });

    expect(shouldAcceptMeetOffer(signalingRosterRef.current, "host-1")).toBe(true);
    expect(shouldAcceptMeetOffer(signalingRosterRef.current, "knocker-1")).toBe(false);
    expect(shouldAcceptMeetOffer(signalingRosterRef.current, "forged-1")).toBe(false);
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "end", by: "Admin" })),
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "mute", peerId: "self-1" })),
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "admit", peerId: "self-1" })),
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
      peers: [accountHost],
      messages: [
        {
          from: "host-1",
          type: "chat",
          payload: stamped(buildMeetControlMessage({ kind: "deny", peerId: "self-1" })),
        },
      ],
    });

    expect(toastApi.showError).toHaveBeenCalledWith(meetLabels.joinDenied);
  });
});
