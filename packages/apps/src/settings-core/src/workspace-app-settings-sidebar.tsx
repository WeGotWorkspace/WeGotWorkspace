import { useMemo } from "react";
import { Settings } from "lucide-react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { useWorkspaceAppSettingsEntry } from "@/settings-core/src/use-workspace-app-settings-entry";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";

/**
 * The app's Settings row for the sidebar, or null when the app has no settings
 * panel. Suite norm: the last row of the app's first (unlabelled) section.
 */
export function useWorkspaceAppSettingsSidebarItem(appId: WorkspaceAppId): MenuItemProps | null {
  const entry = useWorkspaceAppSettingsEntry(appId);
  return useMemo(
    () =>
      entry.visible
        ? {
            label: entry.label,
            icon: <Settings className="size-4" />,
            onClick: entry.onClick,
          }
        : null,
    [entry.visible, entry.label, entry.onClick],
  );
}

/** Appends the Settings row (when there is one) to a section's items. */
export function withSettingsSidebarItem(
  items: MenuItemProps[],
  settingsItem: MenuItemProps | null,
): MenuItemProps[] {
  return settingsItem ? [...items, settingsItem] : items;
}

/**
 * Settings in a section of its own, at the top of the sidebar: for apps whose
 * first section is a labelled list (Calendar's calendars, Meet's channels).
 */
export function WorkspaceAppSettingsSidebarSection({ appId }: { appId: WorkspaceAppId }) {
  const item = useWorkspaceAppSettingsSidebarItem(appId);
  if (!item) return null;
  return <SidebarSection className="workspace-app-settings-sidebar-section" items={[item]} />;
}

/** The app's first (unlabelled) sidebar section, with Settings as its last row. */
export function WorkspaceAppPrimarySidebarSection({
  appId,
  items,
  className,
}: {
  appId: WorkspaceAppId;
  items: MenuItemProps[];
  className?: string;
}) {
  const settingsItem = useWorkspaceAppSettingsSidebarItem(appId);
  return (
    <SidebarSection className={className} items={withSettingsSidebarItem(items, settingsItem)} />
  );
}
