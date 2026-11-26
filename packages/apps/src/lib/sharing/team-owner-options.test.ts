import { describe, expect, it } from "vitest";
import {
  mapSettingsGroupsToTeamOptions,
  teamsOfferedAsOwner,
  viewerIsAdminOfNoTeam,
} from "@/lib/sharing/team-owner-options";

describe("team owner options", () => {
  it("maps settings groups to slugs and keeps the team-admin flag", () => {
    expect(
      mapSettingsGroupsToTeamOptions([
        { id: "principals/groups/design", displayName: " Design ", isTeamAdmin: true },
        { id: "sales", displayName: "", isTeamAdmin: false },
        { id: "principals/groups/ops", displayName: "Ops" },
      ]),
    ).toEqual([
      { slug: "design", displayName: "Design", isTeamAdmin: true },
      { slug: "sales", displayName: "sales", isTeamAdmin: false },
      { slug: "ops", displayName: "Ops" },
    ]);
  });

  it("offers a Team only to its team admins, plus the one a collection already lives in", () => {
    const teams = [
      { slug: "a", displayName: "A", isTeamAdmin: true },
      { slug: "b", displayName: "B", isTeamAdmin: false },
      { slug: "c", displayName: "C" },
    ];
    expect(teamsOfferedAsOwner(teams).map((team) => team.slug)).toEqual(["a", "c"]);
    expect(teamsOfferedAsOwner(teams, "b").map((team) => team.slug)).toEqual(["a", "b", "c"]);
  });

  it("explains only when the viewer is in Teams and admin of none", () => {
    expect(viewerIsAdminOfNoTeam(undefined)).toBe(false);
    expect(viewerIsAdminOfNoTeam([])).toBe(false);
    expect(viewerIsAdminOfNoTeam([{ slug: "a", displayName: "A", isTeamAdmin: false }])).toBe(true);
    expect(
      viewerIsAdminOfNoTeam([
        { slug: "a", displayName: "A", isTeamAdmin: false },
        { slug: "b", displayName: "B", isTeamAdmin: true },
      ]),
    ).toBe(false);
  });
});
