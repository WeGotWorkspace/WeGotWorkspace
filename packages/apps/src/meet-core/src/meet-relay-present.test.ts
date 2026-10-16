import { describe, expect, it } from "vitest";
import { presentMeetRelayOutcome } from "@/meet-core/src/meet-relay-present";

const unavailable = "relay_unavailable" as const;

describe("presentMeetRelayOutcome", () => {
  it("shows the network sentence and the other person's tile", () => {
    const presented = presentMeetRelayOutcome({
      selfId: "self",
      remoteId: "ada",
      name: "Ada",
      outcome: unavailable,
    });
    expect(presented.toast).toBe(
      "Your network is blocking direct connections. Try another network, or ask your administrator.",
    );
    expect(presented.tile).toEqual({ peerId: "ada", message: "Can't connect to Ada" });
  });

  it("hides the tile when the failure is the viewer's own pre-check", () => {
    const presented = presentMeetRelayOutcome({
      selfId: "self",
      remoteId: "self",
      name: "Guest",
      outcome: unavailable,
    });
    expect(presented.tile).toBeNull();
    expect(presented.toast).toContain("ask your administrator");
  });
});
