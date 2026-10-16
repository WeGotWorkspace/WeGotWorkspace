import { describe, expect, it } from "vitest";
import { meetRelayCopy } from "@/meet-core/src/meet-relay-copy";

const name = "Ada";

describe("meetRelayCopy", () => {
  it("shows the affected user only the non-blocking network sentence", () => {
    expect(meetRelayCopy({ audience: "affected", outcome: "relay_unavailable", name })).toBe(
      "Your network is blocking direct connections. Try another network, or ask your administrator.",
    );
    expect(meetRelayCopy({ audience: "affected", outcome: "issued", name })).toBeNull();
  });

  it("shows other participants only the tile sentence", () => {
    expect(meetRelayCopy({ audience: "participant", outcome: "relay_unavailable", name })).toBe(
      "Can't connect to Ada",
    );
    expect(meetRelayCopy({ audience: "participant", outcome: "issued", name })).toBeNull();
  });
});
