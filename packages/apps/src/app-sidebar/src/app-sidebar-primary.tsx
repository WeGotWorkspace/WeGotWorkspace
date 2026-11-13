import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { useAppSettingsEntry } from "@/lib/settings/app-settings-entry";
import type { MenuItemProps } from "@/menu-item/src/menu-item";

/**
 * The app's Settings as a menu row, or null when the app has no settings panel.
 * Suite norm: the last option in the menu of the sidebar's primary button (via
 * `AppSidebar settingsAppId`); a sidebar without a primary button lists it as a row.
 */
export function useWorkspaceAppSettingsMenuItem(
  appId: WorkspaceAppId,
): (MenuItemProps & { id: string }) | null {
  const entry = useAppSettingsEntry(appId);
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

/**
 * `items` with the app's Settings as the last row: for a sidebar section when the
 * sidebar has no primary button whose menu could hold it. Pass `enabled` false
 * when that menu is there.
 */
export function useItemsWithAppSettingsRow<T extends MenuItemProps>(
  appId: WorkspaceAppId,
  items: T[],
  enabled = true,
): (T | (MenuItemProps & { id: string }))[] {
  const settingsItem = useWorkspaceAppSettingsMenuItem(appId);
  return useMemo(
    () => (enabled && settingsItem ? [...items, settingsItem] : items),
    [enabled, items, settingsItem],
  );
}

/** What the sidebar's primary button gets from {@link AppSidebar}. */
export type AppSidebarPrimaryContextValue = {
  /** The app's Settings, the last option of the primary button's menu. */
  settingsItem: DropdownMenuItemProps | null;
};

const AppSidebarPrimaryContext = createContext<AppSidebarPrimaryContextValue | null>(null);

/** Inside the sidebar's primary slot: its settings option; null anywhere else. */
export function useAppSidebarPrimary(): AppSidebarPrimaryContextValue | null {
  return useContext(AppSidebarPrimaryContext);
}

function WithSettings({ appId, children }: { appId: WorkspaceAppId; children: ReactNode }) {
  const settingsItem = useWorkspaceAppSettingsMenuItem(appId);
  const value = useMemo(() => ({ settingsItem }), [settingsItem]);
  return (
    <AppSidebarPrimaryContext.Provider value={value}>{children}</AppSidebarPrimaryContext.Provider>
  );
}

const NO_SETTINGS: AppSidebarPrimaryContextValue = { settingsItem: null };

/** Wraps the sidebar's primary button; `settingsAppId` adds that app's Settings to its menu. */
export function AppSidebarPrimaryProvider({
  settingsAppId,
  children,
}: {
  settingsAppId?: WorkspaceAppId;
  children: ReactNode;
}) {
  if (settingsAppId) return <WithSettings appId={settingsAppId}>{children}</WithSettings>;
  return (
    <AppSidebarPrimaryContext.Provider value={NO_SETTINGS}>
      {children}
    </AppSidebarPrimaryContext.Provider>
  );
}
