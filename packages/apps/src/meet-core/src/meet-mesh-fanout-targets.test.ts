import { describe, expect, it } from "vitest";
import {
  meetMeshFanoutUsernames,
  meetMeshFanoutUsernamesUnion,
  meetMeshSenderMayHint,
} from "@/meet-core/src/meet-mesh-fanout-targets";
import type { MeetChannel } from "@/lib/models/meet-types";

function channel(overrides: Partial<MeetChannel> & Pick<MeetChannel, "id">): MeetChannel {
  return {
    name: overrides.id,
    kind: "channel",
    scope: "personal",
    ...overrides,
  };
}

/** A Team channel: alice and bob are in the Team; carol is a coworker outside it. */
const teamChannel = channel({
  id: "chat-grp-eng",
  scope: "group",
  groupSlug: "eng",
  members: ["alice", "bob"],
});

describe("meetMeshFanoutUsernames", () => {
  it("targets only the DM peer", () => {
    expect(meetMeshFanoutUsernames({ channelId: "dm:bob", selfUsername: "alice" })).toEqual([
      "bob",
    ]);
  });

  it("targets the server roster of a Team channel and nobody outside it", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-grp-eng",
        selfUsername: "alice",
        channels: [teamChannel],
      }),
    ).toEqual(["bob"]);
  });

  it("targets the roster of a shared channel, owner and group sharees included", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-secret",
        selfUsername: "bob",
        channels: [
          channel({
            id: "chat-secret",
            isSharee: true,
            shareWith: null,
            members: ["alice", "bob", "dave"],
          }),
        ],
      }).sort(),
    ).toEqual(["alice", "dave"]);
  });

  it("falls back to explicit user grants when the cached row has no roster", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-secret",
        selfUsername: "alice",
        channels: [
          channel({
            id: "chat-secret",
            shareWith: {
              alice: { mayRead: true },
              bob: { mayRead: true },
              "groups/eng": { mayRead: true },
            },
          }),
        ],
      }),
    ).toEqual(["bob"]);
  });

  it("sends a Team channel without a cached roster to nobody", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-grp-eng",
        selfUsername: "alice",
        channels: [channel({ id: "chat-grp-eng", scope: "group", groupSlug: "eng" })],
      }),
    ).toEqual([]);
  });

  it("sends an unknown channel to nobody", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-missing",
        selfUsername: "alice",
        channels: [teamChannel],
      }),
    ).toEqual([]);
  });

  it("unions share add and remove across snapshots", () => {
    expect(
      meetMeshFanoutUsernamesUnion({ selfUsername: "alice" }, [
        channel({ id: "chat-secret", members: ["alice", "bob"] }),
        channel({ id: "chat-secret", members: ["alice", "carol"] }),
      ]).sort(),
    ).toEqual(["bob", "carol"]);
  });
});

describe("meetMeshSenderMayHint", () => {
  it("accepts only the DM peer", () => {
    expect(meetMeshSenderMayHint({ channelId: "dm:bob", senderUsername: "bob" })).toBe(true);
    expect(meetMeshSenderMayHint({ channelId: "dm:bob", senderUsername: "mallory" })).toBe(false);
  });

  it("accepts a Team channel member and drops a coworker outside the Team", () => {
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-grp-eng",
        senderUsername: "bob",
        selfUsername: "alice",
        channels: [teamChannel],
      }),
    ).toBe(true);
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-grp-eng",
        senderUsername: "carol",
        selfUsername: "alice",
        channels: [teamChannel],
      }),
    ).toBe(false);
  });

  it("drops a payload for a channel whose roster does not list the receiver", () => {
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-grp-eng",
        senderUsername: "bob",
        selfUsername: "carol",
        channels: [teamChannel],
      }),
    ).toBe(false);
  });

  it("compares usernames case-insensitively", () => {
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-grp-eng",
        senderUsername: "Bob",
        selfUsername: "ALICE",
        channels: [teamChannel],
      }),
    ).toBe(true);
  });

  it("falls back to explicit user grants and skips group grants", () => {
    const shared = channel({
      id: "chat-secret",
      shareWith: { bob: { mayRead: true }, "groups/eng": { mayRead: true } },
    });
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-secret",
        senderUsername: "bob",
        channels: [shared],
      }),
    ).toBe(true);
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-secret",
        senderUsername: "carol",
        channels: [shared],
      }),
    ).toBe(false);
  });

  it("is fail-closed when membership cannot be resolved", () => {
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-grp-eng",
        senderUsername: "bob",
        channels: [channel({ id: "chat-grp-eng", scope: "group", groupSlug: "eng" })],
      }),
    ).toBe(false);
    expect(
      meetMeshSenderMayHint({
        channelId: "chat-missing",
        senderUsername: "bob",
        channels: [teamChannel],
      }),
    ).toBe(false);
  });
});
