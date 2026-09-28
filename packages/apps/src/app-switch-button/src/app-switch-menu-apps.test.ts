import { describe, expect, it } from "vitest";
import {
  APP_SWITCH_PRODUCT_APPS,
  appSwitchUtilityApps,
  orderedAppSwitchApps,
} from "@/app-switch-button/src/app-switch-menu-apps";
import { orderedWorkspaceHomeApps } from "@/wegotworkspace/src/wegotworkspace-home-apps";
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

describe("app switch / home chrome order", () => {
  it("lists product apps alphabetically by display name", () => {
    expect(APP_SWITCH_PRODUCT_APPS.map((app) => app.id)).toEqual([
      "calendar",
      "contacts",
      "docs",
      "drive",
      "meet",
      "notes",
      "tasks",
    ]);
  });

  it("includes Admin when the user has admin capability", () => {
    expect(appSwitchUtilityApps(true).map((app) => app.id)).toEqual(["admin", "settings"]);
  });

  it("hides Admin when the user lacks admin capability", () => {
    expect(appSwitchUtilityApps(false).map((app) => app.id)).toEqual(["settings"]);
  });

  it("puts Admin and Settings after alphabetical product apps", () => {
    expect(orderedAppSwitchApps(true).map((app) => app.id)).toEqual([
      "calendar",
      "contacts",
      "docs",
      "drive",
      "meet",
      "notes",
      "tasks",
      "admin",
      "settings",
    ]);
  });

  it("keeps the home grid in the same order as the app switch", () => {
    expect(orderedWorkspaceHomeApps(() => {}).map((app) => app.id)).toEqual(
      orderedAppSwitchApps(true).map((app) => app.id),
    );
  });
});
