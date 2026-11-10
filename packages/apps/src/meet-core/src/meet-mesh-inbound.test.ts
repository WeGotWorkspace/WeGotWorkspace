import { describe, expect, it } from "vitest";
import {
  acceptMeetMeshChannel,
  acceptMeetMeshSender,
  meetMeshReceiveCallChannelId,
} from "@/meet-core/src/meet-mesh-inbound";
import type { MeetChannel } from "@/lib/models/meet-types";

describe("acceptMeetMeshChannel", () => {
  it("accepts DMs without a known collection id", () => {
    expect(acceptMeetMeshChannel("dm:alice", new Set())).toBe(true);
  });

  it("accepts only channels already in the local ACL cache", () => {
    expect(acceptMeetMeshChannel("chat-secret", new Set(["chat-general"]))).toBe(false);
    expect(acceptMeetMeshChannel("chat-general", new Set(["chat-general"]))).toBe(true);
  });
});

describe("acceptMeetMeshSender", () => {
  const secret: MeetChannel = {
    id: "chat-secret",
    name: "secret",
    kind: "channel",
    scope: "personal",
    shareWith: { bob: { mayRead: true } },
  };

  it("drops a sender who is not in shareWith even when the receiver knows the channel", () => {
    expect(
      acceptMeetMeshSender("chat-secret", "mallory", new Set(["chat-secret"]), {
        channels: [secret],
      }),
    ).toBe(false);
    expect(
      acceptMeetMeshSender("chat-secret", "bob", new Set(["chat-secret"]), {
        channels: [secret],
      }),
    ).toBe(true);
  });
});

describe("acceptMeetMeshSender on a Team channel", () => {
  const team: MeetChannel = {
    id: "chat-grp-eng",
    name: "eng",
    kind: "channel",
    scope: "group",
    groupSlug: "eng",
    members: ["alice", "bob"],
  };

  it("accepts a member's payload for a member", () => {
    expect(
      acceptMeetMeshSender("chat-grp-eng", "bob", new Set(["chat-grp-eng"]), {
        channels: [team],
        self: "alice",
      }),
    ).toBe(true);
  });

  it("drops a payload from a coworker outside the Team", () => {
    expect(
      acceptMeetMeshSender("chat-grp-eng", "carol", new Set(["chat-grp-eng"]), {
        channels: [team],
        self: "alice",
      }),
    ).toBe(false);
  });

  it("drops a payload when the receiver is not on the cached roster", () => {
    expect(
      acceptMeetMeshSender("chat-grp-eng", "bob", new Set(["chat-grp-eng"]), {
        channels: [team],
        self: "carol",
      }),
    ).toBe(false);
  });
});

describe("meetMeshReceiveCallChannelId", () => {
  it("rewrites virtual DM ids onto the sender", () => {
    expect(meetMeshReceiveCallChannelId("dm:bob", "alice")).toBe("dm:alice");
    expect(meetMeshReceiveCallChannelId("chat-general", "alice")).toBe("chat-general");
  });
});
