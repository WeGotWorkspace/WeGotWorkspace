import { describe, expect, it } from "vitest";
import { teamRoomsFromSettingsState } from "@/presence-core/src/presence-team-rooms";

describe("teamRoomsFromSettingsState", () => {
  it("maps own Teams to sorted presence rooms", () => {
    expect(
      teamRoomsFromSettingsState({
        groups: [
          { id: "principals/groups/sales", displayName: "Sales" },
          { id: "principals/groups/design", displayName: "Design" },
          { id: "principals/groups/design", displayName: "Design" },
        ],
      }),
    ).toEqual(["groups.design", "groups.sales"]);
  });

  it("returns no rooms for a user in no Team or an unexpected answer", () => {
    expect(teamRoomsFromSettingsState({ groups: [] })).toEqual([]);
    expect(teamRoomsFromSettingsState({})).toEqual([]);
    expect(teamRoomsFromSettingsState(null)).toEqual([]);
    expect(
      teamRoomsFromSettingsState({ groups: [{ id: "principals/alice" }, { id: 4 }, null] }),
    ).toEqual([]);
  });
});
