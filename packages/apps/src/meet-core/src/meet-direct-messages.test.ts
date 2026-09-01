import { describe, expect, it } from "vitest";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import {
  findMeetDirectMessagePerson,
  isMeetDirectMessageChannelId,
  meetDirectMessageChannelId,
  meetDirectMessagePeople,
  meetDirectMessagePrincipalId,
} from "@/meet-core/src/meet-direct-messages";

const directory: CollectionSharePrincipal[] = [
  { id: "ada.lovelace", displayName: "Ada Lovelace", principalType: "user" },
  { id: "grace.hopper", displayName: "Grace Hopper", principalType: "user" },
  { id: "demo.user", displayName: "Demo User", principalType: "user" },
  { id: "groups/editorial", displayName: "Editorial", principalType: "group" },
];

describe("meetDirectMessageChannelId", () => {
  it("prefixes directory user ids", () => {
    expect(meetDirectMessageChannelId("ada.lovelace")).toBe("dm:ada.lovelace");
    expect(isMeetDirectMessageChannelId("dm:ada.lovelace")).toBe(true);
    expect(isMeetDirectMessageChannelId("channel-general")).toBe(false);
    expect(meetDirectMessagePrincipalId("dm:ada.lovelace")).toBe("ada.lovelace");
    expect(meetDirectMessagePrincipalId("channel-general")).toBeNull();
  });
});

describe("meetDirectMessagePeople", () => {
  it("lists directory users, skips groups and the current user, and attaches fixture unread", () => {
    expect(
      meetDirectMessagePeople(directory, {
        excludeId: "demo.user",
        unreadByPrincipalId: { "ada.lovelace": 2, "grace.hopper": 0 },
      }),
    ).toEqual([
      {
        id: "ada.lovelace",
        displayName: "Ada Lovelace",
        channelId: "dm:ada.lovelace",
        unreadCount: 2,
      },
      {
        id: "grace.hopper",
        displayName: "Grace Hopper",
        channelId: "dm:grace.hopper",
      },
    ]);
  });
});

describe("findMeetDirectMessagePerson", () => {
  it("resolves a selected dm channel id", () => {
    const people = meetDirectMessagePeople(directory, { excludeId: "demo.user" });
    expect(findMeetDirectMessagePerson(people, "dm:grace.hopper")?.displayName).toBe(
      "Grace Hopper",
    );
    expect(findMeetDirectMessagePerson(people, "channel-general")).toBeNull();
  });
});
