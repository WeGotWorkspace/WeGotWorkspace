import { describe, expect, it } from "vitest";
import {
  collapseStaleIdentityPeers,
  peerIdentityKey,
} from "@/lib/rtc/session/stale-identity-peers";

describe("peerIdentityKey", () => {
  it("prefers the server-derived username over the display name", () => {
    expect(peerIdentityKey({ name: "Wouter", user: "wouter" }, true)).toBe("u:wouter");
  });

  it("falls back to display name only when allowed", () => {
    expect(peerIdentityKey({ name: "Wouter" }, true)).toBe("n:Wouter");
    expect(peerIdentityKey({ name: "Wouter" }, false)).toBeNull();
  });
});

describe("collapseStaleIdentityPeers", () => {
  it("drops an incumbent ghost when the same user returns with a new peer id", () => {
    const previous = [{ id: "a1cef2020cc59fb1", name: "Wouter", user: "wouter" }];
    const next = [
      { id: "a1cef2020cc59fb1", name: "Wouter", user: "wouter" },
      { id: "b7e0deadbeef0001", name: "Wouter", user: "wouter" },
      { id: "cccccccccccccccc", name: "Admin", user: "admin" },
    ];

    expect(collapseStaleIdentityPeers(previous, next, true)).toEqual({
      keep: [
        { id: "b7e0deadbeef0001", name: "Wouter", user: "wouter" },
        { id: "cccccccccccccccc", name: "Admin", user: "admin" },
      ],
      staleIds: ["a1cef2020cc59fb1"],
    });
  });

  it("does not collapse two distinct users who share a display name", () => {
    const next = [
      { id: "aaaaaaaaaaaaaaaa", name: "Wouter", user: "wouter" },
      { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter2" },
    ];

    expect(collapseStaleIdentityPeers([], next, true)).toEqual({
      keep: next,
      staleIds: [],
    });
  });

  it("leaves a first-snapshot duplicate roster intact when there is no incumbent", () => {
    const next = [
      { id: "oldoldoldoldold1", name: "Wouter", user: "wouter" },
      { id: "newnewnewnewnew1", name: "Wouter", user: "wouter" },
    ];

    expect(collapseStaleIdentityPeers([], next, true)).toEqual({
      keep: next,
      staleIds: [],
    });
  });

  it("does not use display-name fallback when disabled (meet)", () => {
    const previous = [{ id: "guest-old", name: "Guest" }];
    const next = [
      { id: "guest-old", name: "Guest" },
      { id: "guest-new", name: "Guest" },
    ];

    expect(collapseStaleIdentityPeers(previous, next, false)).toEqual({
      keep: next,
      staleIds: [],
    });
  });
});
