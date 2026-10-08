import { describe, expect, it } from "vitest";
import { MEET_RELAY_SETTINGS_PATH } from "@/meet-core/src/meet-relay-copy";
import { presentMeetRelayOutcome } from "@/meet-core/src/meet-relay-present";

const unavailable = "relay_unavailable" as const;

describe("presentMeetRelayOutcome", () => {
  it("shows an admin the firewall banner and Set up, and nothing else", () => {
    const presented = presentMeetRelayOutcome({
      role: "admin",
      selfId: "self",
      remoteId: "ada",
      name: "Ada",
      outcome: unavailable,
    });
    expect(presented.toast).toBeNull();
    expect(presented.tile).toBeNull();
    expect(presented.banner?.setupHref).toBe(MEET_RELAY_SETTINGS_PATH);
    expect(presented.banner?.message).toContain("Ada");
  });

  it("shows a non-admin the network sentence and the other person's tile", () => {
    const presented = presentMeetRelayOutcome({
      role: "user",
      selfId: "self",
      remoteId: "ada",
      name: "Ada",
      outcome: unavailable,
    });
    expect(presented.banner).toBeNull();
    expect(presented.toast).toBe(
      "Your network is blocking direct connections. Try another network, or ask your administrator.",
    );
    expect(presented.tile).toEqual({ peerId: "ada", message: "Can't connect to Ada" });
    expect(presented.banner?.setupHref).toBeUndefined();
  });

  it("hides Set up from a guest, including when the failure is their own pre-check", () => {
    const presented = presentMeetRelayOutcome({
      role: "guest",
      selfId: "self",
      remoteId: "self",
      name: "Guest",
      outcome: unavailable,
    });
    expect(presented.banner).toBeNull();
    expect(presented.tile).toBeNull();
    expect(presented.toast).toContain("ask your administrator");
  });
});
