import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { useWorkspaceAppSettingsMenuItem } from "@/settings-core/src/workspace-app-settings-sidebar";

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
