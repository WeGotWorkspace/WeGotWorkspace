import { wgwFetch, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";
import { fetchWgwPlugins } from "@/lib/api/wgw/plugins";
import type { WgwSettingsStateResponse } from "@/lib/api/wgw/types";

/** Same principal URI the API uses for admin role (`AdminRoleResolver::ADMIN_GROUP_URI`). */
export const WGW_ADMIN_GROUP_URI = "principals/groups/administrators";

/** True when `/settings/state` groups include the administrators group (home + app switch gate). */
export function settingsGroupsIncludeAdmin(
  groups: ReadonlyArray<{ id: string }> | null | undefined,
): boolean {
  return Boolean(groups?.some((group) => group.id === WGW_ADMIN_GROUP_URI));
}

export type WeGotWorkspaceHomeState = {
  showAdmin: boolean;
  showCalendar: boolean;
  showContacts: boolean;
  showTasks: boolean;
  userDisplayName: string;
  showUserMenu: boolean;
  pluginAppTiles: {
    id: string;
    label: string;
    route: string;
    icon?: string;
    sessionApiPath?: string;
  }[];
};

export const MOCK_HOME_STATE: WeGotWorkspaceHomeState = {
  showAdmin: true,
  showCalendar: true,
  showContacts: true,
  showTasks: true,
  userDisplayName: "Demo User",
  showUserMenu: true,
  pluginAppTiles: [],
};

export async function fetchWeGotWorkspaceHomeState(): Promise<WeGotWorkspaceHomeState> {
  if (!wgwLiveApiEnabled()) {
    return MOCK_HOME_STATE;
  }

  try {
    const [settingsRes, plugins] = await Promise.all([
      wgwFetch("/settings/state"),
      fetchWgwPlugins().catch(() => []),
    ]);
    const pluginAppTiles = plugins
      .filter((plugin) => plugin.active && plugin.appTile)
      .map((plugin) => ({
        ...plugin.appTile!,
        sessionApiPath: plugin.integration?.sessionApiPath,
      }));
    const res = settingsRes;
    if (!res.ok) {
      return {
        showAdmin: false,
        showCalendar: true,
        showContacts: true,
        showTasks: true,
        userDisplayName: "User",
        showUserMenu: false,
        pluginAppTiles,
      };
    }
    const state = (await wgwReadJson(res)) as WgwSettingsStateResponse & {
      apps?: { calendars?: boolean; contacts?: boolean; tasks?: boolean };
    };
    const userDisplayName = state.user.displayName?.trim() || state.user.username?.trim() || "User";
    const showUserMenu = Boolean(state.user.username?.trim() || state.user.email?.trim());
    return {
      showAdmin: settingsGroupsIncludeAdmin(state.groups),
      showCalendar: state.apps?.calendars !== false,
      showContacts: state.apps?.contacts !== false,
      showTasks: state.apps?.tasks !== false,
      userDisplayName,
      showUserMenu,
      pluginAppTiles,
    };
  } catch {
    return {
      showAdmin: false,
      showCalendar: true,
      showContacts: true,
      showTasks: true,
      userDisplayName: "User",
      showUserMenu: false,
      pluginAppTiles: [],
    };
  }
}
