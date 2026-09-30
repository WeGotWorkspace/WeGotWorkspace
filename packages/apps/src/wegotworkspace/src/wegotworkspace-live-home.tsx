import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { AppsHomeScreen } from "@/apps-home-screen/src/apps-home-screen";
import { useAppToast } from "@/hooks/use-app-toast";
import { wgwEnsurePluginSession } from "@/lib/api/wgw/http";
import { WORKSPACE_APP_ACCENT } from "@/lib/workspace-app-icons";
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
  const { showError } = useAppToast();
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

  const pluginTiles = homeState.pluginAppTiles.map((tile) => ({
    id: tile.id,
    label: tile.label,
    icon: <FileText className="size-4" />,
    accent: WORKSPACE_APP_ACCENT.drive,
    fg: "#ffffff",
    onSelect: () => {
      void (async () => {
        try {
          if (tile.sessionApiPath) {
            await wgwEnsurePluginSession(tile.sessionApiPath);
          }
          window.location.assign(tile.route);
        } catch (error) {
          const detail = error instanceof Error ? error.message : undefined;
          showError("Could not open app", { description: detail });
        }
      })();
    },
  }));

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
    pluginTiles,
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
