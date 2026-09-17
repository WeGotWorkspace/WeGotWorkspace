import { describe, expect, it } from "vitest";
import { shouldConnectMeetPeer } from "@/meet-core/src/meet-rtc-peers";

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
