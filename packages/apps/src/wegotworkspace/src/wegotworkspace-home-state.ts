import { wgwFetch, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";
import type { WgwSettingsStateResponse } from "@/lib/api/wgw/types";

export type WeGotWorkspaceHomeState = {
  showAdmin: boolean;
  showCalendar: boolean;
  showContacts: boolean;
  showTasks: boolean;
  userDisplayName: string;
  showUserMenu: boolean;
};

export const MOCK_HOME_STATE: WeGotWorkspaceHomeState = {
  showAdmin: true,
  showCalendar: true,
  showContacts: true,
  showTasks: true,
  userDisplayName: "Demo User",
  showUserMenu: true,
};

export async function fetchWeGotWorkspaceHomeState(): Promise<WeGotWorkspaceHomeState> {
  if (!wgwLiveApiEnabled()) {
    return MOCK_HOME_STATE;
  }

  try {
    const res = await wgwFetch("/settings/state");
    if (!res.ok) {
      return {
        showAdmin: false,
        showCalendar: true,
        showContacts: true,
        showTasks: true,
        userDisplayName: "User",
        showUserMenu: false,
      };
    }
    const state = (await wgwReadJson(res)) as WgwSettingsStateResponse & {
      apps?: { calendars?: boolean; contacts?: boolean; tasks?: boolean };
    };
    const userDisplayName = state.user.displayName?.trim() || state.user.username?.trim() || "User";
    const showUserMenu = Boolean(state.user.username?.trim() || state.user.email?.trim());
    return {
      // Admin is a role per user, not membership of a Team (#1925).
      showAdmin: state.isAdmin === true,
      showCalendar: state.apps?.calendars !== false,
      showContacts: state.apps?.contacts !== false,
      showTasks: state.apps?.tasks !== false,
      userDisplayName,
      showUserMenu,
    };
  } catch {
    return {
      showAdmin: false,
      showCalendar: true,
      showContacts: true,
      showTasks: true,
      userDisplayName: "User",
      showUserMenu: false,
    };
  }
}
