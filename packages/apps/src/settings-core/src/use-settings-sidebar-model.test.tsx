import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSettingsSidebarModel } from "@/settings-core/src/use-settings-sidebar-model";

describe("useSettingsSidebarModel", () => {
  it("includes Connected assistants when MCP is enabled", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(true));
    expect(result.current.map((section) => section.id)).toEqual([
      "profile",
      "memberships",
      "mail",
      "offline",
      "assistants",
    ]);
    expect(result.current.some((section) => section.label === "Connected assistants")).toBe(true);
  });

  it("omits Connected assistants when the admin kill-switch is off", () => {
    const { result } = renderHook(() => useSettingsSidebarModel(false));
    expect(result.current.map((section) => section.id)).toEqual([
      "profile",
      "memberships",
      "mail",
      "offline",
    ]);
    expect(result.current.some((section) => section.label === "Connected assistants")).toBe(false);
  });
});
