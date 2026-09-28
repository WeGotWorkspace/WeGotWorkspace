import { describe, expect, it } from "vitest";
import {
  appendLocalGroup,
  applyGroupMembership,
  groupIdFromName,
  groupsWithout,
  memberUsernames,
  renameGroup,
  requiredGroupName,
  usersWithoutGroup,
  validateNewGroup,
} from "@/admin-core/src/admin-group-directory";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

describe("groupIdFromName", () => {
  it("slugs non-alphanumeric runs into the principals path", () => {
    expect(groupIdFromName("Ops Team")).toBe("principals/groups/ops-team");
    expect(groupIdFromName("Hello!!!")).toBe("principals/groups/hello-");
  });
});

describe("validateNewGroup", () => {
  const { data } = createAdminAppBootstrap();

  it("requires a name and rejects an existing id or case-insensitive name", () => {
    expect(validateNewGroup(data.groups, "   ")).toEqual({
      ok: false,
      message: "Group name is required",
    });
    expect(requiredGroupName("  Ops  ")).toEqual({ ok: true, name: "Ops" });
    expect(validateNewGroup(data.groups, " Administrators ")).toEqual({
      ok: false,
      message: "Group already exists",
    });
  });

  it("returns the trimmed name and principal id", () => {
    expect(validateNewGroup(data.groups, " Ops Team ")).toEqual({
      ok: true,
      name: "Ops Team",
      id: "principals/groups/ops-team",
    });
  });
});

describe("local group membership", () => {
  const { data } = createAdminAppBootstrap();
  const groupId = "principals/groups/ops-team";

  it("lists member usernames in directory order", () => {
    expect(memberUsernames(data.users, ["carol", "alice"])).toEqual(["alice", "carol"]);
  });

  it("appends, renames, and changes membership only when it differs", () => {
    const appended = appendLocalGroup(data.groups, { id: groupId, name: "Ops Team" });
    expect(appended).toHaveLength(2);
    expect(appended[1]).toEqual({ id: groupId, name: "Ops Team", displayName: "Ops Team" });

    const renamed = renameGroup(appended, groupId, "Operations");
    expect(renamed[1]).toMatchObject({ name: "Operations", displayName: "Operations" });
    expect(renamed[0]).toBe(appended[0]);

    const withAlice = applyGroupMembership(data.users, groupId, ["alice"]);
    expect(withAlice[0]?.groups).toEqual(["principals/groups/administrators", groupId]);
    expect(withAlice[1]).toBe(data.users[1]);

    const unchanged = applyGroupMembership(withAlice, groupId, ["alice"]);
    expect(unchanged[0]).toBe(withAlice[0]);

    const removed = applyGroupMembership(withAlice, groupId, []);
    expect(removed[0]?.groups).toEqual(["principals/groups/administrators"]);
  });

  it("drops a group and strips it from every user", () => {
    const groups = appendLocalGroup(data.groups, { id: groupId, name: "Ops Team" });
    const users = applyGroupMembership(data.users, groupId, ["carol"]);
    expect(groupsWithout(groups, groupId)).toEqual(data.groups);
    expect(usersWithoutGroup(users, groupId)[1]?.groups).toEqual([]);
    expect(usersWithoutGroup(users, groupId)[0]?.groups).toEqual([
      "principals/groups/administrators",
    ]);
  });
});
