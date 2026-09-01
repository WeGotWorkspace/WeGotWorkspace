import { describe, expect, it } from "vitest";
import { partitionMeetChannels } from "@/meet-core/src/meet-channel-partition";
import type { MeetChannel } from "@/meet-core/src/meet-types";

function channel(
  partial: Partial<MeetChannel> & Pick<MeetChannel, "id" | "name" | "kind">,
): MeetChannel {
  return {
    scope: "personal",
    isSharee: false,
    ...partial,
  };
}

describe("partitionMeetChannels", () => {
  it("uses partitionOwnedAndShared then splits owned rows by kind", () => {
    const items: MeetChannel[] = [
      channel({ id: "m-zebra", name: "Zebra standup", kind: "meeting" }),
      channel({ id: "c-shared", name: "Design", kind: "channel", isSharee: true }),
      channel({ id: "c-alpha", name: "Alpha", kind: "channel" }),
      channel({
        id: "m-shared",
        name: "All-hands",
        kind: "meeting",
        isSharee: true,
        guestAccess: true,
      }),
      channel({ id: "c-zeta", name: "Zeta", kind: "channel" }),
      channel({ id: "m-alpha", name: "Alpha studio", kind: "meeting" }),
    ];

    expect(partitionMeetChannels(items)).toEqual({
      channels: [
        channel({ id: "c-alpha", name: "Alpha", kind: "channel" }),
        channel({ id: "c-zeta", name: "Zeta", kind: "channel" }),
      ],
      shared: [
        channel({
          id: "m-shared",
          name: "All-hands",
          kind: "meeting",
          isSharee: true,
          guestAccess: true,
        }),
        channel({ id: "c-shared", name: "Design", kind: "channel", isSharee: true }),
      ],
      meetings: [
        channel({ id: "m-alpha", name: "Alpha studio", kind: "meeting" }),
        channel({ id: "m-zebra", name: "Zebra standup", kind: "meeting" }),
      ],
    });
  });

  it("keeps group-owned (not isSharee) rows out of Shared with me", () => {
    const items: MeetChannel[] = [
      channel({
        id: "c-group",
        name: "Team room",
        kind: "channel",
        scope: "group",
        groupSlug: "editorial",
        isSharee: false,
      }),
    ];

    expect(partitionMeetChannels(items)).toEqual({
      channels: [items[0]],
      shared: [],
      meetings: [],
    });
  });
});
