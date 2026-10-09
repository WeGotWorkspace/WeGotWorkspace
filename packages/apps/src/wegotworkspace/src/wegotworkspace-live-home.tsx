import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppsHomeScreen } from "@/apps-home-screen/src/apps-home-screen";
import { orderedWorkspaceHomeApps } from "@/wegotworkspace/src/wegotworkspace-home-apps";
import {
  fetchWeGotWorkspaceHomeState,
  MOCK_HOME_STATE,
  type WeGotWorkspaceHomeState,
} from "@/wegotworkspace/src/wegotworkspace-home-state";
import { useWeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-story-logout";

export function WeGotWorkspaceLiveHome() {
  const navigate = useNavigate();
  const onLogout = useWeGotWorkspaceLogout();
  const [homeState, setHomeState] = useState<WeGotWorkspaceHomeState>(MOCK_HOME_STATE);

  useEffect(() => {
    let cancelled = false;
    void fetchWeGotWorkspaceHomeState().then((next) => {
      if (!cancelled) setHomeState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const apps = orderedWorkspaceHomeApps(
    (app) => {
      void navigate({ to: app.to });
    },
    {
      showCalendar: homeState.showCalendar,
      showContacts: homeState.showContacts,
      showTasks: homeState.showTasks,
      showAdmin: homeState.showAdmin,
    },
  );

  return (
    <AppsHomeScreen
      apps={apps}
      className="min-h-dvh"
      userDisplayName={homeState.userDisplayName}
      showUserMenu={homeState.showUserMenu}
      onLogout={onLogout}
    />
  );
}
