/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeMeetRoomChatIntoChannel, type MeetChatLine } from "@/meet-core/src/meet-chat-line";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import type { MeetCallSessionState } from "@/meet-core/src/use-meet-call-session";
import { useMeetMutations } from "@/meet-core/src/use-meet-mutations";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";

const CLIENT_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const toastApi = {
  show: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

function createRoomStub(): MeetRoomState {
  return {
    status: "in-call",
    setStatus: vi.fn(),
    setError: vi.fn(),
    setRoomCode: vi.fn(),
    setSelfId: vi.fn(),
    setStartedAt: vi.fn(),
    setElapsedSeconds: vi.fn(),
    resetIdleMediaDefaults: vi.fn(),
    setPeers: vi.fn(),
    setChatMessages: vi.fn(),
    setWaitingForAdmission: vi.fn(),
    setKnockers: vi.fn(),
    setEndedMessage: vi.fn(),
    resetPeerMaps: vi.fn(),
    roomCodeRef: { current: "abc123" },
    selfIdRef: { current: "peer-1" },
    joinInFlightRef: { current: null },
    statusRef: { current: "in-call" as const },
    displayNameRef: { current: "Guest" },
    waitingForAdmissionRef: { current: false },
    peerNamesRef: { current: new Map([["peer-2", "Alex"]]) },
    setVideoOn: vi.fn(),
  } as unknown as MeetRoomState;
}

function trackChatMessages(room: MeetRoomState): () => MeetChatLine[] {
  let lines: MeetChatLine[] = [];
  room.setChatMessages = vi.fn((value) => {
    lines = typeof value === "function" ? value(lines) : value;
  }) as MeetRoomState["setChatMessages"];
  return () => lines;
}

function savedChannelMessage(body: string): ChatMessage {
  return {
    id: "saved-1",
    channelId: "chan-1",
    authorId: "user-1",
    authorName: "You",
    body,
    createdAt: 10,
    reactions: [],
    mentions: [],
    previews: [],
  };
}

function createSessionStub(operations?: {
  reserveRoom?: ReturnType<typeof vi.fn>;
  chat?: ReturnType<typeof vi.fn>;
}) {
  const meetRtc = {
    leave: vi.fn().mockResolvedValue(undefined),
    join: vi.fn().mockResolvedValue(undefined),
    getSessionKey: vi.fn(() => null),
  };
  return {
    meetRtc,
    operationsRef: { current: operations },
    debugRtc: vi.fn(),
    ensureLocalMedia: vi.fn().mockResolvedValue(undefined),
    stopLocalMedia: vi.fn(),
  } as unknown as MeetCallSessionState;
}

describe("useMeetMutations joinRoom", () => {
  it("does not mint a second signaling peer when the same room is already live", async () => {
    const session = createSessionStub();
    const room = createRoomStub();
    room.statusRef.current = "in-call";
    room.roomCodeRef.current = "chat-general";
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room,
        session,
        canModerateKnocks: false,
        leaveRef,
        persistentCall: true,
      }),
    );

    await result.current.joinRoom("chat-general");
    await result.current.joinRoom("chat-general");

    expect(session.meetRtc.join).not.toHaveBeenCalled();
    expect(room.setSelfId).not.toHaveBeenCalled();
  });

  it("joins once when two startCalls overlap on an idle room", async () => {
    const session = createSessionStub();
    const room = createRoomStub();
    room.status = "idle";
    room.statusRef.current = "idle";
    room.roomCodeRef.current = null;
    room.selfIdRef.current = null;
    room.setStatus = vi.fn((status) => {
      room.statusRef.current =
        typeof status === "function"
          ? status(room.statusRef.current)
          : (status as typeof room.statusRef.current);
    });
    let releaseJoin: (() => void) | undefined;
    session.meetRtc.join = vi.fn(async () => {
      return new Promise<{ peerId: string; peers: never[]; sessionKey?: string | null }>(
        (resolve) => {
          releaseJoin = () => {
            resolve({ peerId: "peer-1", peers: [], sessionKey: null });
          };
        },
      );
    });
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room,
        session,
        canModerateKnocks: false,
        leaveRef,
        persistentCall: true,
      }),
    );

    const first = result.current.joinRoom("chat-general");
    const second = result.current.joinRoom("chat-general");
    await vi.waitFor(() => {
      expect(session.meetRtc.join).toHaveBeenCalledTimes(1);
    });
    releaseJoin?.();
    await Promise.all([first, second]);
    expect(session.meetRtc.join).toHaveBeenCalledTimes(1);
  });
});

describe("useMeetMutations requestJoin", () => {
  it("does not mint a second knock peer while waiting for admission", async () => {
    const session = createSessionStub();
    const room = createRoomStub();
    room.status = "idle";
    room.statusRef.current = "idle";
    room.roomCodeRef.current = "chat-test";
    room.waitingForAdmissionRef.current = true;
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room,
        session,
        canModerateKnocks: false,
        leaveRef,
        persistentCall: true,
      }),
    );

    await result.current.requestJoin("chat-test");

    expect(session.meetRtc.join).not.toHaveBeenCalled();
  });
});

describe("useMeetMutations", () => {
  it("does not leave on rerender when the room object identity changes", () => {
    const session = createSessionStub();
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { rerender, unmount } = renderHook(
      ({ room }) =>
        useMeetMutations({
          room,
          session,
          canModerateKnocks: false,
          leaveRef,
        }),
      { initialProps: { room: createRoomStub() } },
    );

    for (let i = 0; i < 25; i++) {
      rerender({ room: createRoomStub() });
    }

    expect(session.meetRtc.leave).not.toHaveBeenCalled();

    unmount();
    expect(session.meetRtc.leave).toHaveBeenCalledTimes(1);
  });

  it("keeps the call alive on unmount when the call is suite-persistent", () => {
    const session = createSessionStub();
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { unmount } = renderHook(() =>
      useMeetMutations({
        room: createRoomStub(),
        session,
        canModerateKnocks: false,
        leaveRef,
        persistentCall: true,
      }),
    );

    unmount();
    expect(session.meetRtc.leave).not.toHaveBeenCalled();
    // leaveRef stays populated so the mini-player can still hang up.
    expect(leaveRef.current).toBeTypeOf("function");
  });

  it("reserves an ad-hoc room owned by the acting user before joining", async () => {
    const reserveRoom = vi.fn().mockResolvedValue({ reserved: true, active: false });
    const session = createSessionStub({ reserveRoom });
    const room = createRoomStub();
    room.displayNameRef = { current: "Bob" };
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room,
        session,
        canModerateKnocks: true,
        actingUsername: "bob",
        leaveRef,
      }),
    );

    await result.current.startMeeting();

    expect(reserveRoom).toHaveBeenCalledTimes(1);
    const reserved = reserveRoom.mock.calls[0]?.[0] as {
      room: string;
      ownerPrincipal: string;
      expiresAt: string;
    };
    expect(reserved.ownerPrincipal).toBe("u:bob");
    expect(reserved.room).toMatch(/^[a-hj-np-z2-9]{4}-[a-hj-np-z2-9]{4}-[a-hj-np-z2-9]{4}$/);
    expect(session.meetRtc.join).toHaveBeenCalled();
  });
});

describe("useMeetMutations mutePeer", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    toastApi.showError.mockClear();
  });

  it("sends a mute control for another peer when the caller can moderate", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, delivered: 1 });
    const session = createSessionStub({ chat });
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room: createRoomStub(),
        session,
        canModerateKnocks: true,
        leaveRef,
      }),
    );

    await result.current.mutePeer("peer-2");

    expect(chat).toHaveBeenCalledTimes(1);
    const sent = chat.mock.calls[0]?.[0] as { text: string; from: string; room: string };
    expect(sent.room).toBe("abc123");
    expect(sent.from).toBe("peer-1");
    expect(sent.text).toContain('"kind":"mute"');
    expect(sent.text).toContain('"peerId":"peer-2"');
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.mutedParticipant("Alex"), {
      severity: "info",
    });
  });

  it("sends an unmute control for another peer when the caller can moderate", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, delivered: 1 });
    const session = createSessionStub({ chat });
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room: createRoomStub(),
        session,
        canModerateKnocks: true,
        leaveRef,
      }),
    );

    await result.current.mutePeer("peer-2", false);

    expect(chat).toHaveBeenCalledTimes(1);
    const sent = chat.mock.calls[0]?.[0] as { text: string };
    expect(sent.text).toContain('"kind":"unmute"');
    expect(sent.text).toContain('"peerId":"peer-2"');
    expect(toastApi.show).toHaveBeenCalledWith(meetLabels.unmutedParticipant("Alex"), {
      severity: "info",
    });
  });

  it("does not send mute when the caller cannot moderate", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, delivered: 1 });
    const session = createSessionStub({ chat });
    const leaveRef = { current: null as null | (() => Promise<void>) };

    const { result } = renderHook(() =>
      useMeetMutations({
        room: createRoomStub(),
        session,
        canModerateKnocks: false,
        leaveRef,
      }),
    );

    await result.current.mutePeer("peer-2");

    expect(chat).not.toHaveBeenCalled();
    expect(toastApi.show).not.toHaveBeenCalled();
  });
});

describe("useMeetMutations sendChat", () => {
  function renderSendChat() {
    const room = createRoomStub();
    const lines = trackChatMessages(room);
    const chat = vi.fn().mockResolvedValue(undefined);
    const session = createSessionStub({ chat });
    const leaveRef = { current: null as null | (() => Promise<void>) };
    const rendered = renderHook(() =>
      useMeetMutations({
        room,
        session,
        canModerateKnocks: false,
        leaveRef,
        persistentCall: true,
      }),
    );
    return { ...rendered, lines, chat };
  }

  it("posts the room copy without waiting for the channel save", async () => {
    const { result, chat, lines } = renderSendChat();

    await result.current.sendChat("hello", {
      echoId: CLIENT_ULID,
      saved: new Promise(() => {}),
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]?.[0]).toMatchObject({
      room: "abc123",
      from: "peer-1",
      text: `__wgw_meet_channel_chat__:${CLIENT_ULID}\nhello`,
    });
    expect(lines().map((line) => line.body)).toEqual(["hello"]);
  });

  it("posts the room copy when the channel save rejects", async () => {
    const { result, chat, lines } = renderSendChat();

    await result.current.sendChat("hello", {
      echoId: CLIENT_ULID,
      saved: Promise.reject(new Error("channel save failed")),
    });

    expect(chat.mock.calls[0]?.[0]).toMatchObject({
      text: `__wgw_meet_channel_chat__:${CLIENT_ULID}\nhello`,
    });
    expect(lines().map((line) => line.body)).toEqual(["hello"]);
  });

  it("never puts a local placeholder id on the room copy", async () => {
    const { result, chat } = renderSendChat();

    await result.current.sendChat("hello", {
      echoId: "local-1710000000000",
      saved: Promise.resolve(null),
    });

    expect(chat.mock.calls[0]?.[0]).toMatchObject({ text: "hello" });
  });

  it("removes the local line once the channel save resolves with a message", async () => {
    const { result, lines } = renderSendChat();

    await result.current.sendChat("hello", {
      echoId: CLIENT_ULID,
      saved: Promise.resolve(savedChannelMessage("hello")),
    });

    await vi.waitFor(() => {
      expect(lines()).toEqual([]);
    });
  });

  it("keeps the local line when the channel save resolves null", async () => {
    const { result, lines } = renderSendChat();

    await result.current.sendChat("hello", { echoId: null, saved: Promise.resolve(null) });

    expect(lines().map((line) => line.body)).toEqual(["hello"]);
  });

  it("does not restore the original text after the saved message is deleted", async () => {
    const { result, lines } = renderSendChat();
    const saved = savedChannelMessage("hello");
    await result.current.sendChat("hello", { echoId: saved.id, saved: Promise.resolve(saved) });
    await vi.waitFor(() => {
      expect(lines()).toEqual([]);
    });

    const deleted = { ...saved, deletedAt: Date.now(), body: "", previews: [], mentions: [] };
    const merged = mergeMeetRoomChatIntoChannel([deleted], lines(), "chan-1");

    expect(merged.map((row) => row.body)).not.toContain("hello");
    expect(merged).toEqual([deleted]);
  });

  it("posts plain room text when there is no channel save", async () => {
    const { result, chat, lines } = renderSendChat();

    await result.current.sendChat("hello");

    expect(lines().map((line) => line.body)).toEqual(["hello"]);
    expect(chat.mock.calls[0]?.[0]).toMatchObject({ text: "hello" });
  });

  it("keeps the saved channel message when the room copy fails", async () => {
    const { result, lines, chat } = renderSendChat();
    chat.mockRejectedValueOnce(new Error("room down"));
    toastApi.showError.mockClear();

    await result.current.sendChat("hello", {
      echoId: CLIENT_ULID,
      saved: Promise.resolve(savedChannelMessage("hello")),
    });

    expect(lines()).toEqual([]);
    expect(toastApi.showError).not.toHaveBeenCalled();
  });

  it("toasts when the room copy fails and nothing was saved", async () => {
    const { result, lines, chat } = renderSendChat();
    chat.mockRejectedValueOnce(new Error("room down"));
    toastApi.showError.mockClear();

    await result.current.sendChat("hello", { echoId: null, saved: Promise.resolve(null) });

    expect(lines()).toEqual([]);
    expect(toastApi.showError).toHaveBeenCalledWith("room down");
  });
});
