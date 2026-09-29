import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import {
  reachabilityFromShell,
  SettingsReachabilityProvider,
} from "@/settings-core/src/settings-reachability";
import { resetSettingsRegistryForTests } from "@/settings-core/src/settings-registry";
import { useWorkspaceAppSettingsEntry } from "@/settings-core/src/use-workspace-app-settings-entry";

function ShellCtx({ children }: { children: ReactNode }) {
  return (
    <SettingsReachabilityProvider value={reachabilityFromShell({})}>
      {children}
    </SettingsReachabilityProvider>
  );
}

describe("useWorkspaceAppSettingsEntry", () => {
  beforeEach(() => {
    resetSettingsRegistryForTests();
    registerBuiltinSettings();
  });

  afterEach(() => {
    resetSettingsRegistryForTests();
  });

  it("shows Mail from shell reachability without settings bootstrap", () => {
    const { result } = renderHook(() => useWorkspaceAppSettingsEntry("mail"), {
      wrapper: ShellCtx,
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.label).toBe("Settings");
  });

  it("shows Notes when a reachable slice is registered", () => {
    const { result } = renderHook(() => useWorkspaceAppSettingsEntry("notes"), {
      wrapper: ShellCtx,
    });
    expect(result.current.visible).toBe(true);
  });

  it("hides Drive when no reachable slice is registered", () => {
    const { result } = renderHook(() => useWorkspaceAppSettingsEntry("drive"), {
      wrapper: ShellCtx,
    });
    expect(result.current.visible).toBe(false);
  });
});
