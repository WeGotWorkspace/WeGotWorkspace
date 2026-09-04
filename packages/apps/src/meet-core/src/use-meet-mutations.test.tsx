/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MeetCallSessionState } from "@/meet-core/src/use-meet-call-session";
import { useMeetMutations } from "@/meet-core/src/use-meet-mutations";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";

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
    statusRef: { current: "in-call" as const },
    displayNameRef: { current: "Guest" },
  } as unknown as MeetRoomState;
}

function createSessionStub(operations?: { reserveRoom?: ReturnType<typeof vi.fn> }) {
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
    expect(reserved.room).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(session.meetRtc.join).toHaveBeenCalled();
  });
});
