import { wgwFetch, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";
import { fetchWgwPlugins } from "@/lib/api/wgw/plugins";
import type { WgwSettingsStateResponse } from "@/lib/api/wgw/types";

const ADMIN_GROUP_ID = "principals/groups/administrators";

export type WeGotWorkspaceHomeState = {
  showAdmin: boolean;
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
        showContacts: true,
        showTasks: true,
        userDisplayName: "User",
        showUserMenu: false,
        pluginAppTiles,
      };
    }
    const state = (await wgwReadJson(res)) as WgwSettingsStateResponse & {
      apps?: { contacts?: boolean; tasks?: boolean };
    };
    const userDisplayName = state.user.displayName?.trim() || state.user.username?.trim() || "User";
    const showUserMenu = Boolean(state.user.username?.trim() || state.user.email?.trim());
    return {
      showAdmin: state.groups.some((group) => group.id === ADMIN_GROUP_ID),
      showContacts: state.apps?.contacts !== false,
      showTasks: state.apps?.tasks !== false,
      userDisplayName,
      showUserMenu,
      pluginAppTiles,
    };
  } catch {
    return {
      showAdmin: false,
      showContacts: true,
      showTasks: true,
      userDisplayName: "User",
      showUserMenu: false,
      pluginAppTiles: [],
    };
  }
}
