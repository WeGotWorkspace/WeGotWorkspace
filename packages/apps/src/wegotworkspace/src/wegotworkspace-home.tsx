import { useNavigate } from "@tanstack/react-router";
import { AppsHomeScreen } from "@/apps-home-screen/src/apps-home-screen";
import { orderedWorkspaceHomeApps } from "@/wegotworkspace/src/wegotworkspace-home-apps";
import { useWeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-story-logout";

export function WeGotWorkspaceHome() {
  const navigate = useNavigate();
  const onLogout = useWeGotWorkspaceLogout();

  const apps = orderedWorkspaceHomeApps((app) => {
    void navigate({ to: app.to });
  });

  return (
    <AppsHomeScreen
      apps={apps}
      className="min-h-dvh"
      userDisplayName="Demo User"
      showUserMenu
      onLogout={onLogout}
    />
  );
}
