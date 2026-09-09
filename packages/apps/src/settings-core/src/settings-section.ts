import type { SettingsSection } from "@/settings-core/src/settings-types";

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "profile";

export const SETTINGS_SECTIONS = [
  "profile",
  "memberships",
  "mail",
  "offline",
  "assistants",
] as const satisfies readonly SettingsSection[];

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function isSettingsPathname(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Sidebar + pane are available only when the admin MCP kill-switch is on. */
export function settingsSectionIsReachable(section: SettingsSection, mcpEnabled: boolean): boolean {
  return section !== "assistants" || mcpEnabled;
}

export function resolveSettingsSection(
  requested: string | undefined,
  mcpEnabled: boolean,
): SettingsSection {
  if (!isSettingsSection(requested) || !settingsSectionIsReachable(requested, mcpEnabled)) {
    return SETTINGS_DEFAULT_SECTION;
  }
  return requested;
}

export function settingsPathFor(section: SettingsSection): string {
  return section === SETTINGS_DEFAULT_SECTION ? "/settings" : `/settings/${section}`;
}
