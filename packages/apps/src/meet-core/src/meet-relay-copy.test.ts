import { describe, expect, it } from "vitest";
import { meetRelayCopy, MEET_RELAY_SETTINGS_PATH } from "@/meet-core/src/meet-relay-copy";

const name = "Ada";

describe("meetRelayCopy", () => {
  it("shows the affected user only the non-blocking network sentence", () => {
    const copy = meetRelayCopy({ audience: "affected", outcome: "relay_unavailable", name });
    expect(copy?.message).toBe(
      "Your network is blocking direct connections. Try another network, or ask your administrator.",
    );
    expect(copy?.setupHref).toBeUndefined();
    expect(meetRelayCopy({ audience: "affected", outcome: "issued", name })).toBeNull();
  });

  it("shows other participants only the tile sentence", () => {
    expect(meetRelayCopy({ audience: "participant", outcome: "relay_unavailable", name })).toEqual({
      message: "Can't connect to Ada",
    });
    expect(meetRelayCopy({ audience: "participant", outcome: "issued", name })).toBeNull();
  });

  it("shows a self-hosted admin the firewall sentence and Set up", () => {
    const copy = meetRelayCopy({ audience: "admin", outcome: "relay_unavailable", name });
    expect(copy?.message).toBe(
      "Ada can't join the call because of a firewall. A TURN server fixes this.",
    );
    expect(copy?.setupHref).toBe(MEET_RELAY_SETTINGS_PATH);
    expect(copy?.docsHref).toContain("rtc-network-matrix.md");
  });

  it("hides Set up from a plan that already includes relay", () => {
    const copy = meetRelayCopy({
      audience: "admin",
      outcome: "issued",
      name,
      relayIncludedInService: true,
      planHref: "/plan",
    });
    expect(copy?.message).toBe(
      "Direct connections aren't possible on this network; your plan's relay is used automatically.",
    );
    expect(copy?.setupHref).toBeUndefined();
    expect(copy?.planHref).toBe("/plan");
  });
});
