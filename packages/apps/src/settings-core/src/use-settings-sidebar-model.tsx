import { useMemo } from "react";
import { reachabilityFromSettingsData } from "@/settings-core/src/settings-reachability";
import {
  getSettingsPanel,
  panelsForNav,
  type SettingsPanel,
} from "@/settings-core/src/settings-registry";
import type { SettingsPanelId } from "@/settings-core/src/settings-types";

const FALLBACK_PROFILE_PANEL: SettingsPanel = {
  id: "profile",
  label: "Profile",
  description: "Your account details",
  icon: null,
  group: "account",
};

export type SettingsSidebarGroups = {
  account: SettingsPanel[];
  apps: SettingsPanel[];
};

export function settingsSectionDescriptor(id: SettingsPanelId): SettingsPanel {
  return getSettingsPanel(id) ?? FALLBACK_PROFILE_PANEL;
}

export function useSettingsSidebarModel(mcpEnabled: boolean): SettingsSidebarGroups {
  return useMemo(() => {
    const nav = panelsForNav(reachabilityFromSettingsData({ mcpEnabled }));
    return {
      account: nav.filter((panel) => panel.group === "account"),
      apps: nav.filter((panel) => panel.group === "apps"),
    };
  }, [mcpEnabled]);
}
