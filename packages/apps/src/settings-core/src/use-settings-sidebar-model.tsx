import { useMemo } from "react";
import { reachabilityFromSettingsData } from "@/settings-core/src/settings-reachability";
import {
  getSettingsPanel,
  panelsForNav,
  type SettingsPanel,
} from "@/settings-core/src/settings-registry";
import type { SettingsPanelGroup, SettingsPanelId } from "@/lib/models/settings-types";

const FALLBACK_PROFILE_PANEL: SettingsPanel = {
  id: "profile",
  label: "Profile",
  description: "Your account details",
  icon: null,
  group: "account",
};

export type SettingsSidebarGroups = Record<SettingsPanelGroup, SettingsPanel[]>;

/** Sidebar order, top to bottom. */
export const SETTINGS_GROUP_ORDER: readonly SettingsPanelGroup[] = [
  "account",
  "connections",
  "device",
  "apps",
  "about",
];

export const SETTINGS_GROUP_LABELS: Record<SettingsPanelGroup, string> = {
  account: "Account",
  connections: "Connections",
  device: "Device",
  apps: "Apps",
  about: "About",
};

export function settingsSectionDescriptor(id: SettingsPanelId): SettingsPanel {
  return getSettingsPanel(id) ?? FALLBACK_PROFILE_PANEL;
}

export function useSettingsSidebarModel(mcpEnabled: boolean): SettingsSidebarGroups {
  return useMemo(() => {
    const nav = panelsForNav(reachabilityFromSettingsData({ mcpEnabled }));
    return Object.fromEntries(
      SETTINGS_GROUP_ORDER.map((group) => [group, nav.filter((panel) => panel.group === group)]),
    ) as SettingsSidebarGroups;
  }, [mcpEnabled]);
}
