import { describe, expect, it } from "vitest";
import {
  meetMeshFanoutUsernames,
  meetMeshFanoutUsernamesUnion,
} from "@/meet-core/src/meet-mesh-fanout-targets";
import type { MeetChannel } from "@/meet-core/src/meet-types";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

const directory: CollectionSharePrincipal[] = [
  { id: "bob", displayName: "Bob", principalType: "user" },
  { id: "carol", displayName: "Carol", principalType: "user" },
  { id: "groups/eng", displayName: "Eng", principalType: "group" },
];

function channel(overrides: Partial<MeetChannel> & Pick<MeetChannel, "id">): MeetChannel {
  return {
    name: overrides.id,
    kind: "channel",
    scope: "personal",
    ...overrides,
  };
}

describe("meetMeshFanoutUsernames", () => {
  it("targets only the DM peer", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "dm:bob",
        selfUsername: "alice",
        directory,
      }),
    ).toEqual(["bob"]);
  });

  it("targets explicit shareWith users and skips groups and self", () => {
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
        directory,
      }),
    ).toEqual(["bob"]);
  });

  it("widens group-owned channels to directory users (receiver still ACL-drops)", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-grp-eng",
        selfUsername: "alice",
        channels: [channel({ id: "chat-grp-eng", scope: "group", groupSlug: "eng" })],
        directory,
      }).sort(),
    ).toEqual(["bob", "carol"]);
  });

  it("unions share add and remove across snapshots", () => {
    expect(
      meetMeshFanoutUsernamesUnion({ selfUsername: "alice", directory }, [
        channel({
          id: "chat-secret",
          shareWith: { bob: { mayRead: true } },
        }),
        channel({
          id: "chat-secret",
          shareWith: { carol: { mayRead: true } },
        }),
      ]).sort(),
    ).toEqual(["bob", "carol"]);
  });

  it("returns nobody when membership cannot be resolved", () => {
    expect(
      meetMeshFanoutUsernames({
        channelId: "chat-empty",
        selfUsername: "alice",
        channels: [channel({ id: "chat-empty" })],
        directory,
      }),
    ).toEqual([]);
  });
});
