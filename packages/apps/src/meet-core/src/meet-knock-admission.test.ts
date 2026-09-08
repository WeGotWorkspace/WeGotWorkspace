import { describe, expect, it, vi } from "vitest";
import { completeMeetKnockAdmission } from "@/meet-core/src/meet-knock-admission";

describe("completeMeetKnockAdmission", () => {
  it("tears down waiting chrome before rename-rejoin", async () => {
    const order: string[] = [];
    const updateJoinName = vi.fn(async () => {
      order.push("rejoin");
    });
    const setWaitingForAdmission = vi.fn((value: boolean) => {
      order.push(`waiting:${String(value)}`);
    });
    const setStatus = vi.fn((status: string) => {
      order.push(`status:${status}`);
    });
    const setStartedAt = vi.fn();
    const onAdmitted = vi.fn(() => {
      order.push("admitted");
    });

    await expect(
      completeMeetKnockAdmission({
        waiting: true,
        roomCode: "room-1",
        selfPeerId: "self-1",
        displayName: "Guest",
        updateJoinName,
        setWaitingForAdmission,
        setStatus,
        setStartedAt,
        onAdmitted,
      }),
    ).resolves.toBe(true);

    expect(order[0]).toBe("waiting:false");
    expect(order[1]).toBe("status:in-call");
    expect(order).toContain("rejoin");
    expect(order.indexOf("waiting:false")).toBeLessThan(order.indexOf("rejoin"));
    expect(updateJoinName).toHaveBeenCalledWith("Guest");
  });

  it("still leaves the wait UI when rename-rejoin throws", async () => {
    const setWaitingForAdmission = vi.fn();
    const setStatus = vi.fn();
    const setStartedAt = vi.fn();

    await expect(
      completeMeetKnockAdmission({
        waiting: true,
        roomCode: "room-1",
        selfPeerId: "self-1",
        displayName: "Alex",
        updateJoinName: async () => {
          throw new Error("knock_required");
        },
        setWaitingForAdmission,
        setStatus,
        setStartedAt,
      }),
    ).resolves.toBe(true);

    expect(setWaitingForAdmission).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith("in-call");
  });

  it("does nothing unless this peer is waiting in a room", async () => {
    const setWaitingForAdmission = vi.fn();
    const setStatus = vi.fn();
    const setStartedAt = vi.fn();
    const updateJoinName = vi.fn();

    await expect(
      completeMeetKnockAdmission({
        waiting: false,
        roomCode: "room-1",
        selfPeerId: "self-1",
        displayName: "Guest",
        updateJoinName,
        setWaitingForAdmission,
        setStatus,
        setStartedAt,
      }),
    ).resolves.toBe(false);
    await expect(
      completeMeetKnockAdmission({
        waiting: true,
        roomCode: null,
        selfPeerId: "self-1",
        displayName: "Guest",
        updateJoinName,
        setWaitingForAdmission,
        setStatus,
        setStartedAt,
      }),
    ).resolves.toBe(false);

    expect(setWaitingForAdmission).not.toHaveBeenCalled();
    expect(updateJoinName).not.toHaveBeenCalled();
  });
});
