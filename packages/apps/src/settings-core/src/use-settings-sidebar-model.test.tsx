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

  it("groups Account, Connections, Device, Apps and About, with Connected assistants when MCP is on", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(true));
    expect(result.current.account.map((section) => section.id)).toEqual(["profile", "memberships", "security"]);
    expect(result.current.connections.map((section) => section.id)).toEqual([
      "assistants",
      "incoming-email",
    ]);
    expect(result.current.device.map((section) => section.id)).toEqual([
      "offline",
      "appearance",
      "diagnostics",
    ]);
    expect(result.current.about.map((section) => section.id)).toEqual(["about"]);
    expect(result.current.apps.map((section) => section.id)).toEqual([
      "calendar",
      "tasks",
      "contacts",
      "notes",
      "docs",
      "meet",
    ]);
    expect(
      result.current.connections.some((section) => section.label === "Connected assistants"),
    ).toBe(true);
  });

  it("omits Connected assistants when the admin kill-switch is off", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(false));
    expect(result.current.account.map((section) => section.id)).toEqual(["profile", "memberships", "security"]);
    expect(result.current.connections.map((section) => section.id)).toEqual(["incoming-email"]);
    expect(result.current.apps.map((section) => section.id)).toEqual([
      "calendar",
      "tasks",
      "contacts",
      "notes",
      "docs",
      "meet",
    ]);
    expect(
      result.current.connections.some((section) => section.label === "Connected assistants"),
    ).toBe(false);
  });
});
