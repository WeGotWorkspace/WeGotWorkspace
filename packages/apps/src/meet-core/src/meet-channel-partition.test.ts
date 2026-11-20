import { describe, expect, it } from "vitest";
import {
  meetChannelLockedByProject,
  meetSelectionUnderProject,
  partitionMeetChannels,
} from "@/meet-core/src/meet-channel-partition";
import type { MeetChannel } from "@/lib/models/meet-types";

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
      projects: [],
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
      projects: [],
    });
  });
});

describe("Project channels (#818)", () => {
  const team = channel({
    id: "c-team",
    name: "Design",
    kind: "channel",
    scope: "group",
    groupSlug: "design",
  });
  const named = channel({ id: "c-named", name: "Random", kind: "channel" });
  const web = channel({
    id: "c-web",
    name: "Website relaunch",
    kind: "channel",
    scope: "group",
    groupSlug: "design",
    projectId: "p-web",
  });
  const brand = channel({
    id: "c-brand",
    name: "Brand book",
    kind: "channel",
    scope: "group",
    groupSlug: "design",
    projectId: "p-brand",
  });
  const meeting = channel({ id: "m-1", name: "Standup", kind: "meeting" });
  const items = [web, team, named, brand, meeting];

  it("lists Project channels in their own group with All Projects", () => {
    expect(partitionMeetChannels(items)).toEqual({
      channels: [team, named],
      shared: [],
      meetings: [meeting],
      projects: [brand, web],
    });
  });

  it("lists only the selected Project's channel", () => {
    expect(partitionMeetChannels(items, "p-web")).toEqual({
      channels: [],
      shared: [],
      meetings: [],
      projects: [web],
    });
  });

  it("falls back to the Project channel when the open channel is hidden", () => {
    expect(meetSelectionUnderProject("c-named", items, "p-web")).toBe("c-web");
    expect(meetSelectionUnderProject("c-web", items, "p-web")).toBe("c-web");
    expect(meetSelectionUnderProject("c-named", items, null)).toBe("c-named");
    // A DM is not a channel row: it stays open.
    expect(meetSelectionUnderProject("dm:ada", items, "p-web")).toBe("dm:ada");
    expect(meetSelectionUnderProject("c-named", [named], "p-web")).toBeNull();
  });

  it("locks a Project channel, or one the server says may not be renamed", () => {
    expect(meetChannelLockedByProject(web)).toBe(true);
    expect(meetChannelLockedByProject(named)).toBe(false);
    expect(meetChannelLockedByProject({ ...named, myRights: { mayRename: false } })).toBe(true);
  });
});
