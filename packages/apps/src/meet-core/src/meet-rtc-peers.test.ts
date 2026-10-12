import { describe, expect, it } from "vitest";
import { shouldAcceptMeetOffer, shouldConnectMeetPeer } from "@/meet-core/src/meet-rtc-peers";

describe("shouldConnectMeetPeer", () => {
  const host = { id: "host-1", name: "Admin" };
  const guest = { id: "guest-1", name: "Ada" };
  const knocker = { id: "guest-1", name: "__wgw_knock__:Ada" };

  it("dials a real remote after admit", () => {
    expect(shouldConnectMeetPeer(host, "guest-1", false)).toBe(true);
    expect(shouldConnectMeetPeer(guest, "host-1", false)).toBe(true);
  });

  it("never treats a distinct remote id as self", () => {
    expect(shouldConnectMeetPeer(host, "guest-1", false)).toBe(true);
    expect(shouldConnectMeetPeer({ id: "host-1", name: "Guest" }, "guest-1", false)).toBe(true);
  });

  it("skips self, knockers, and the waiting-for-admit window", () => {
    expect(shouldConnectMeetPeer(guest, "guest-1", false)).toBe(false);
    expect(shouldConnectMeetPeer(knocker, "host-1", false)).toBe(false);
    expect(shouldConnectMeetPeer(host, "guest-1", true)).toBe(false);
  });
});

describe("shouldAcceptMeetOffer", () => {
  const roster = new Map([
    ["host-1", "Admin"],
    ["guest-1", "Ada"],
    ["knocker-1", "__wgw_knock__:Mallory"],
  ]);

  it("answers an offer from an admitted roster row", () => {
    expect(shouldAcceptMeetOffer(roster, "host-1")).toBe(true);
    expect(shouldAcceptMeetOffer(roster, "guest-1")).toBe(true);
  });

  it("ignores an offer from a knock-named roster row", () => {
    expect(shouldAcceptMeetOffer(roster, "knocker-1")).toBe(false);
  });

  it("ignores an offer from an id that is not in the roster", () => {
    expect(shouldAcceptMeetOffer(roster, "forged-1")).toBe(false);
    expect(shouldAcceptMeetOffer(new Map(), "host-1")).toBe(false);
  });
});
