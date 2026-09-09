import { describe, expect, it } from "vitest";
import {
  isSettingsPathname,
  isSettingsSection,
  resolveSettingsSection,
  SETTINGS_DEFAULT_SECTION,
  settingsNavigateTarget,
  settingsPathFor,
  settingsSectionFromLocation,
  settingsSectionIsReachable,
} from "@/settings-core/src/settings-section";

describe("settings-section", () => {
  it("treats assistants as unreachable when the admin kill-switch is off", () => {
    expect(settingsSectionIsReachable("assistants", false)).toBe(false);
    expect(resolveSettingsSection("assistants", false)).toBe(SETTINGS_DEFAULT_SECTION);
    expect(settingsPathFor(SETTINGS_DEFAULT_SECTION)).toBe("/settings");
  });

  it("keeps assistants reachable when the kill-switch is on", () => {
    expect(settingsSectionIsReachable("assistants", true)).toBe(true);
    expect(resolveSettingsSection("assistants", true)).toBe("assistants");
    expect(settingsPathFor("assistants")).toBe("/settings/assistants");
  });

  it("falls back unknown or missing sections to profile", () => {
    expect(isSettingsSection("assistants")).toBe(true);
    expect(isSettingsSection("nope")).toBe(false);
    expect(resolveSettingsSection("nope", true)).toBe("profile");
    expect(resolveSettingsSection(undefined, true)).toBe("profile");
    expect(isSettingsPathname("/settings")).toBe(true);
    expect(isSettingsPathname("/settings/assistants")).toBe(true);
    expect(isSettingsPathname("/admin")).toBe(false);
  });

  it("reads the section from the path; bare /settings is Profile", () => {
    expect(settingsSectionFromLocation("/settings")).toBe("profile");
    expect(settingsSectionFromLocation("/settings/mail")).toBe("mail");
    expect(settingsSectionFromLocation("/settings/offline")).toBe("offline");
    expect(settingsSectionFromLocation("/admin")).toBe("profile");
  });

  it("builds TanStack navigate targets with $section params", () => {
    expect(settingsNavigateTarget("profile")).toEqual({ to: "/settings", params: {} });
    expect(settingsNavigateTarget("mail")).toEqual({
      to: "/settings/$section",
      params: { section: "mail" },
    });
    expect(settingsNavigateTarget("assistants")).toEqual({
      to: "/settings/$section",
      params: { section: "assistants" },
    });
  });
});
