import { describe, expect, it } from "vitest";
import {
  meetChannelLockedByProject,
  meetSelectionUnderProject,
  partitionMeetChannels,
} from "@/meet-core/src/meet-channel-partition";
import type { MeetChannel } from "@/lib/models/meet-types";
import { projectIdsInScope } from "@/lib/projects/project-match";
import type { WorkspaceProject } from "@/lib/projects/projects-store";

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
      teamChats: [],
    });
  });

  it("lists group-owned (not isSharee) rows as Team chats, not Shared with me", () => {
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
      channels: [],
      shared: [],
      meetings: [],
      projects: [],
      teamChats: [items[0]],
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
      channels: [named],
      shared: [],
      meetings: [meeting],
      projects: [brand, web],
      teamChats: [team],
    });
  });

  it("lists only the selected Project's channel when the Team is unknown", () => {
    expect(partitionMeetChannels(items, "p-web")).toEqual({
      channels: [],
      shared: [],
      meetings: [],
      projects: [web],
      teamChats: [],
    });
  });

  it("lists the Project channel and its Team's chats, hiding the rest", () => {
    const named2 = channel({
      id: "c-named-team",
      name: "Critique",
      kind: "channel",
      scope: "group",
      groupSlug: "design",
    });
    const other = channel({
      id: "c-other",
      name: "Sales",
      kind: "channel",
      scope: "group",
      groupSlug: "sales",
    });
    const otherProject = channel({
      id: "c-op",
      name: "Pitch",
      kind: "channel",
      scope: "group",
      groupSlug: "sales",
      projectId: "p-pitch",
    });
    expect(
      partitionMeetChannels(
        [web, brand, team, named2, named, other, otherProject, meeting],
        "p-web",
        "design",
      ),
    ).toEqual({
      channels: [],
      shared: [],
      meetings: [],
      projects: [web],
      teamChats: [named2, team],
    });
  });

  it("under a Team filter lists all its Projects' channels and its Team chats", () => {
    const other = channel({
      id: "c-other",
      name: "Sales",
      kind: "channel",
      scope: "group",
      groupSlug: "sales",
    });
    const otherProject = channel({
      id: "c-op",
      name: "Pitch",
      kind: "channel",
      scope: "group",
      groupSlug: "sales",
      projectId: "p-pitch",
    });
    expect(
      partitionMeetChannels(
        [web, brand, team, named, other, otherProject, meeting],
        projectIdsInScope("t:design", [
          { id: "p-web", teamSlug: "design" },
          { id: "p-brand", teamSlug: "design" },
          { id: "p-pitch", teamSlug: "sales" },
        ] as WorkspaceProject[]),
        "design",
      ),
    ).toEqual({
      channels: [],
      shared: [],
      meetings: [],
      projects: [brand, web],
      teamChats: [team],
    });
  });

  it("keeps a channel open under a Team filter, else falls back to a Team Project channel", () => {
    const ids = ["p-web", "p-brand"];
    expect(meetSelectionUnderProject("c-brand", items, ids, "design")).toBe("c-brand");
    expect(meetSelectionUnderProject("c-team", items, ids, "design")).toBe("c-team");
    expect(meetSelectionUnderProject("c-named", items, ids, "design")).toBe("c-web");
  });

  it("keeps a Team chat open under the Project filter", () => {
    expect(meetSelectionUnderProject("c-team", items, "p-web", "design")).toBe("c-team");
    expect(meetSelectionUnderProject("c-team", items, "p-web", "sales")).toBe("c-web");
    expect(meetSelectionUnderProject("c-brand", items, "p-web", "design")).toBe("c-web");
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
    expect(meetChannelLockedByProject({ ...named, isDefault: true })).toBe(true);
  });
});

describe("Team chats in every view", () => {
  const a = channel({ id: "a", name: "General", kind: "channel", scope: "group", groupSlug: "t1" });
  const b = channel({ id: "b", name: "General", kind: "channel", scope: "group", groupSlug: "t2" });
  const mine = channel({ id: "m", name: "Notes", kind: "channel" });

  it("puts every Team's chats in teamChats, never also in channels", () => {
    expect(partitionMeetChannels([b, mine, a])).toMatchObject({
      channels: [mine],
      teamChats: [a, b],
    });
  });

  it("keeps only the Project's Team under a Project", () => {
    expect(partitionMeetChannels([a, b, mine], "p-x", "t2").teamChats).toEqual([b]);
  });
});
