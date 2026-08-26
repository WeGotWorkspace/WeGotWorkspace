/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MeetAPIOperations } from "@/meet-core/src/meet-types";
import { useMeetInviteProbe } from "@/meet-core/src/use-meet-invite-probe";

const ROOM = "h8y8-ewp6-al8n";

function operationsWithStatus(roomStatus: MeetAPIOperations["roomStatus"]): MeetAPIOperations {
  return { roomStatus } as MeetAPIOperations;
}

describe("useMeetInviteProbe", () => {
  it("lets a signed-in createdBy / owner start a reserved-empty room", async () => {
    const roomStatus = vi.fn().mockResolvedValue({
      reserved: true,
      active: false,
      ownerPrincipal: "u:bob",
      createdBy: "u:bob",
    });

    const { result } = renderHook(() =>
      useMeetInviteProbe({
        invitedRoom: ROOM,
        inJoinFlow: true,
        hasSignedInIdentity: true,
        operations: operationsWithStatus(roomStatus),
      }),
    );

    await waitFor(() => {
      expect(result.current.canStartReservedRoom).toBe(true);
      expect(result.current.inviteState).toBe("active");
    });
    expect(roomStatus).toHaveBeenCalledWith({ room: ROOM });
  });

  it("keeps an anonymous guest waiting for the host", async () => {
    const roomStatus = vi.fn().mockResolvedValue({ reserved: true, active: false });

    const { result } = renderHook(() =>
      useMeetInviteProbe({
        invitedRoom: ROOM,
        inJoinFlow: true,
        hasSignedInIdentity: false,
        operations: operationsWithStatus(roomStatus),
      }),
    );

    await waitFor(() => {
      expect(result.current.canStartReservedRoom).toBe(false);
      expect(result.current.inviteState).toBe("waiting-for-host");
    });
  });
});
