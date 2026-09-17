import { describe, expect, it } from "vitest";
import { appSwitchUtilityApps } from "@/app-switch-button/src/app-switch-menu-apps";
import {
  settingsGroupsIncludeAdmin,
  WGW_ADMIN_GROUP_URI,
} from "@/wegotworkspace/src/wegotworkspace-home-state";

describe("settingsGroupsIncludeAdmin", () => {
  it("matches the administrators group URI used by AdminRoleResolver", () => {
    expect(WGW_ADMIN_GROUP_URI).toBe("principals/groups/administrators");
    expect(settingsGroupsIncludeAdmin([{ id: WGW_ADMIN_GROUP_URI }])).toBe(true);
  });

  it("is false for non-admin membership and empty/missing groups", () => {
    expect(settingsGroupsIncludeAdmin([{ id: "principals/groups/team" }])).toBe(false);
    expect(settingsGroupsIncludeAdmin([])).toBe(false);
    expect(settingsGroupsIncludeAdmin(undefined)).toBe(false);
  });
});

describe("appSwitchUtilityApps", () => {
  it("includes Admin when the user has admin capability", () => {
    expect(appSwitchUtilityApps(true).map((app) => app.id)).toEqual(["admin", "settings"]);
  });

  it("hides Admin when the user lacks admin capability", () => {
    expect(appSwitchUtilityApps(false).map((app) => app.id)).toEqual(["settings"]);
  });
});
