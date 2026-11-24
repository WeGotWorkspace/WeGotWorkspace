import { describe, expect, it } from "vitest";
import { membersOfTeam } from "@/calendar-core/src/use-team-availability";

const members = [
  { id: "me", name: "Me", isSelf: true, version: "1", teamSlugs: ["design", "sales"] },
  { id: "ada", name: "Ada", isSelf: false, version: "1", teamSlugs: ["design"] },
  { id: "bob", name: "Bob", isSelf: false, version: "1", teamSlugs: ["sales"] },
  { id: "old", name: "Old cache", isSelf: false, version: "1" },
];

describe("membersOfTeam", () => {
  it("lists everyone without a Project", () => {
    expect(membersOfTeam(members, null).map((m) => m.id)).toEqual(["me", "ada", "bob", "old"]);
  });

  it("keeps you and the people who share the Project's Team", () => {
    expect(membersOfTeam(members, "design").map((m) => m.id)).toEqual(["me", "ada", "old"]);
    expect(membersOfTeam(members, "sales").map((m) => m.id)).toEqual(["me", "bob", "old"]);
  });
});
