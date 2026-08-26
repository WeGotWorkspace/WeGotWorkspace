import { describe, expect, it } from "vitest";
import {
  meetActorPrincipal,
  meetInviteStateFromRoomStatus,
  meetRoomStatusAllowsHost,
} from "@/meet-core/src/meet-invite-status";

describe("meetInviteStateFromRoomStatus", () => {
  it("treats an unreserved room as a missing invite", () => {
    expect(
      meetInviteStateFromRoomStatus({ reserved: false, active: false }, { canHost: false }),
    ).toBe("missing");
  });

  it("lets a host start a reserved-empty room", () => {
    expect(
      meetInviteStateFromRoomStatus(
        { reserved: true, active: false, ownerPrincipal: "u:bob" },
        { canHost: true },
      ),
    ).toBe("active");
  });

  it("waits for the host when reserved and empty", () => {
    expect(
      meetInviteStateFromRoomStatus({ reserved: true, active: false }, { canHost: false }),
    ).toBe("waiting-for-host");
  });

  it("shows the join lobby when the reserved room is active", () => {
    expect(
      meetInviteStateFromRoomStatus({ reserved: true, active: true }, { canHost: false }),
    ).toBe("active");
  });
});

describe("meetRoomStatusAllowsHost", () => {
  it("is true only when the GET body includes ownerPrincipal", () => {
    expect(meetRoomStatusAllowsHost({ reserved: true, active: false })).toBe(false);
    expect(
      meetRoomStatusAllowsHost({
        reserved: true,
        active: false,
        ownerPrincipal: "groups/design",
      }),
    ).toBe(true);
  });
});

describe("meetActorPrincipal", () => {
  it("prefixes the username", () => {
    expect(meetActorPrincipal("Bob")).toBe("u:bob");
  });
});
