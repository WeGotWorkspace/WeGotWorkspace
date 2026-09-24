import { describe, expect, it } from "vitest";
import {
  expandMeetTypingChannelKeys,
  meetTypingChannelId,
} from "@/meet-core/src/meet-typing-channel-id";

describe("meetTypingChannelId", () => {
  it("passes channel ids through", () => {
    expect(meetTypingChannelId("administrators", "alice")).toBe("administrators");
  });

  it("canonicalizes virtual DM ids to a sorted pair both peers share", () => {
    expect(meetTypingChannelId("dm:bob", "alice")).toBe("dm:alice:bob");
    expect(meetTypingChannelId("dm:alice", "bob")).toBe("dm:alice:bob");
  });

  it("leaves an already-canonical pair and missing self unchanged", () => {
    expect(meetTypingChannelId("dm:alice:bob", "alice")).toBe("dm:alice:bob");
    expect(meetTypingChannelId("dm:bob", null)).toBe("dm:bob");
    expect(meetTypingChannelId("dm:bob", "")).toBe("dm:bob");
  });
});

describe("expandMeetTypingChannelKeys", () => {
  it("indexes a canonical DM pair under both virtual rail ids", () => {
    expect(expandMeetTypingChannelKeys({ "dm:alice:bob": ["bob"] })).toEqual({
      "dm:alice:bob": ["bob"],
      "dm:alice": ["bob"],
      "dm:bob": ["bob"],
    });
  });

  it("leaves channel rows alone", () => {
    const channel = { administrators: ["bob"] };
    expect(expandMeetTypingChannelKeys(channel)).toEqual(channel);
  });
});
