import { useMemo } from "react";
import { Settings } from "lucide-react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { useWorkspaceAppSettingsEntry } from "@/settings-core/src/use-workspace-app-settings-entry";

/**
 * The app's Settings as a menu row, or null when the app has no settings panel.
 * Suite norm: the last option in the menu of the sidebar's primary button (via
 * `AppSidebar settingsAppId`); a sidebar without a primary button lists it as a row.
 */
export function useWorkspaceAppSettingsMenuItem(
  appId: WorkspaceAppId,
): (MenuItemProps & { id: string }) | null {
  const entry = useWorkspaceAppSettingsEntry(appId);
  return useMemo(
    () =>
      entry.visible
        ? {
            id: "app-settings",
            label: entry.label,
            icon: <Settings className="size-4" aria-hidden />,
            onClick: entry.onClick,
          }
        : null,
    [entry.visible, entry.label, entry.onClick],
  );
}
