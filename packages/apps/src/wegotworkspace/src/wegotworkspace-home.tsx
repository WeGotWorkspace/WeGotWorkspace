import { useNavigate } from "@tanstack/react-router";
import { AppsHomeScreen, type AppsHomeScreenItem } from "@/apps-home-screen/src/apps-home-screen";
import { WORKSPACE_APP_ACCENT, type WorkspaceAppId } from "@/lib/workspace-app-icons";
import { useWeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-story-logout";

function homeAppTile(
  appId: WorkspaceAppId,
  label: string,
  onSelect: () => void,
  fg?: string,
): AppsHomeScreenItem {
  return {
    id: appId,
    label,
    appId,
    accent: WORKSPACE_APP_ACCENT[appId],
    fg,
    onSelect,
  };
}

export function WeGotWorkspaceHome() {
  const navigate = useNavigate();
  const onLogout = useWeGotWorkspaceLogout();

  const apps: AppsHomeScreenItem[] = [
    homeAppTile("notes", "Notes", () => void navigate({ to: "/notes" })),
    homeAppTile("mail", "Mail", () => void navigate({ to: "/mail" })),
    homeAppTile("calendar", "Calendar", () => void navigate({ to: "/calendar" }), "#ffffff"),
    homeAppTile("contacts", "Contacts", () => void navigate({ to: "/contacts" }), "#ffffff"),
    homeAppTile("tasks", "Tasks", () => void navigate({ to: "/tasks" }), "#ffffff"),
    homeAppTile("drive", "Drive", () => void navigate({ to: "/drive" }), "#ffffff"),
    homeAppTile("docs", "Docs", () => void navigate({ to: "/docs" }), "#ffffff"),
    homeAppTile("settings", "Settings", () => void navigate({ to: "/settings" })),
    homeAppTile("meet", "Meet", () => void navigate({ to: "/meet" }), "#ffffff"),
    homeAppTile("admin", "Admin", () => void navigate({ to: "/admin" }), "#ffffff"),
  ];

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
