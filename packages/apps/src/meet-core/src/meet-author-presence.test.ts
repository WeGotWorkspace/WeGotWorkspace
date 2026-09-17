import { describe, expect, it } from "vitest";
import {
  authorPresenceFromRoster,
  mergeAuthorPresence,
} from "@/meet-core/src/meet-author-presence";
import type { PresenceCoworker } from "@/presence-core/src/presence-types";

describe("authorPresenceFromRoster", () => {
  it("maps coworker usernames to online/away and skips empty ids", () => {
    const roster: PresenceCoworker[] = [
      { username: "bob", name: "Bob", status: "online" },
      { username: "carol", name: "Carol", status: "away" },
      { username: "", name: "Ghost", status: "online" },
    ];
    expect(authorPresenceFromRoster(roster)).toEqual({
      bob: "online",
      carol: "away",
    });
  });
});

describe("mergeAuthorPresence", () => {
  it("lets fixture keys override the live roster", () => {
    expect(mergeAuthorPresence({ bob: "online" }, { bob: "away", ada: "online" })).toEqual({
      bob: "away",
      ada: "online",
    });
  });

  it("returns whichever side is present", () => {
    expect(mergeAuthorPresence({ bob: "online" }, undefined)).toEqual({ bob: "online" });
    expect(mergeAuthorPresence(undefined, { bob: "away" })).toEqual({ bob: "away" });
    expect(mergeAuthorPresence(undefined, undefined)).toBeUndefined();
  });
});
