import {
  reachabilityFromSettingsData,
  type SettingsReachabilityContext,
} from "@/settings-core/src/settings-reachability";
import {
  getSettingsPanel,
  isSettingsPanelId,
  panelIsVisible,
} from "@/settings-core/src/settings-registry";
import type { SettingsPanelId, SettingsSection } from "@/settings-core/src/settings-types";

export const SETTINGS_DEFAULT_SECTION: SettingsPanelId = "profile";

export type SettingsNavigateTarget = {
  to: "/settings" | "/settings/$section";
  params: Record<string, string>;
};

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && isSettingsPanelId(value);
}

export function isSettingsPathname(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Derive the Settings section from the path. Bare `/settings` is Profile. */
export function settingsSectionFromLocation(pathname: string): SettingsPanelId {
  const parts = pathname.split("/").filter(Boolean);
  const fromPath = parts[0] === "settings" ? parts[1] : undefined;
  return isSettingsSection(fromPath) ? fromPath : SETTINGS_DEFAULT_SECTION;
}

function reachabilityFromMcp(mcpEnabled: boolean): SettingsReachabilityContext {
  return reachabilityFromSettingsData({ mcpEnabled });
}

/** Sidebar + pane are available when the panel gate passes and at least one slice is reachable. */
export function settingsSectionIsReachable(section: SettingsPanelId, mcpEnabled: boolean): boolean {
  const panel = getSettingsPanel(section);
  if (!panel) return false;
  return panelIsVisible(panel, reachabilityFromMcp(mcpEnabled));
}

export function resolveSettingsSection(
  requested: string | undefined,
  mcpEnabled: boolean,
): SettingsPanelId {
  if (!isSettingsSection(requested) || !settingsSectionIsReachable(requested, mcpEnabled)) {
    return SETTINGS_DEFAULT_SECTION;
  }
  return requested;
}

export function settingsPathFor(section: SettingsPanelId): string {
  return section === SETTINGS_DEFAULT_SECTION ? "/settings" : `/settings/${section}`;
}

/** Router `to` + params so TanStack builds `/settings/$section` instead of an interpolated path. */
export function settingsNavigateTarget(section: SettingsPanelId): SettingsNavigateTarget {
  if (section === SETTINGS_DEFAULT_SECTION) {
    return { to: "/settings", params: {} };
  }
  return { to: "/settings/$section", params: { section } };
}
