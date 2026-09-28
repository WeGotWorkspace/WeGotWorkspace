import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { resetSettingsRegistryForTests } from "@/settings-core/src/settings-registry";
import { useSettingsSidebarModel } from "@/settings-core/src/use-settings-sidebar-model";

describe("useSettingsSidebarModel", () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
    registerBuiltinSettings();
  });

  afterEach(() => {
    resetSettingsRegistryForTests();
  });

  it("groups Account plus Apps → Mail and includes Connected assistants when MCP is on", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(true));
    expect(result.current.account.map((section) => section.id)).toEqual([
      "profile",
      "memberships",
      "offline",
      "assistants",
    ]);
    expect(result.current.apps.map((section) => section.id)).toEqual(["mail"]);
    expect(result.current.account.some((section) => section.label === "Connected assistants")).toBe(
      true,
    );
  });

  it("omits Connected assistants when the admin kill-switch is off", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(false));
    expect(result.current.account.map((section) => section.id)).toEqual([
      "profile",
      "memberships",
      "offline",
    ]);
    expect(result.current.apps.map((section) => section.id)).toEqual(["mail"]);
    expect(result.current.account.some((section) => section.label === "Connected assistants")).toBe(
      false,
    );
  });
});
