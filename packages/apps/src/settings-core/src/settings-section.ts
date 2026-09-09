import type { SettingsSection } from "@/settings-core/src/settings-types";

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "profile";

export const SETTINGS_SECTIONS = [
  "profile",
  "memberships",
  "mail",
  "offline",
  "assistants",
] as const satisfies readonly SettingsSection[];

export type SettingsNavigateTarget = {
  to: "/settings" | "/settings/$section";
  params: Record<string, string>;
};

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value !== undefined && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function isSettingsPathname(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Derive the Settings section from the path. Bare `/settings` is Profile. */
export function settingsSectionFromLocation(pathname: string): SettingsSection {
  const parts = pathname.split("/").filter(Boolean);
  const fromPath = parts[0] === "settings" ? parts[1] : undefined;
  return isSettingsSection(fromPath) ? fromPath : SETTINGS_DEFAULT_SECTION;
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

/** Router `to` + params so TanStack builds `/settings/$section` instead of an interpolated path. */
export function settingsNavigateTarget(section: SettingsSection): SettingsNavigateTarget {
  if (section === SETTINGS_DEFAULT_SECTION) {
    return { to: "/settings", params: {} };
  }
  return { to: "/settings/$section", params: { section } };
}
