import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { useWorkspaceAppSettingsMenuItem } from "@/settings-core/src/workspace-app-settings-sidebar";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";

export type DocsHomeSidebarProps = {
  open: boolean;
  onCloseMobile: () => void;
  showNewDocument: boolean;
  onNewDocument: () => void;
  newDocumentLabel: string;
  newDocumentMenuLabel: string;
  session: WorkspaceSession;
  onLogout?: () => void;
  primaryItems: MenuItemProps[];
  driveItems: MenuItemProps[];
  drivesSectionLabel: string;
};

/** New-document button, view sections, drives, and the signed-in user. */
export function DocsHomeSidebar({
  open,
  onCloseMobile,
  showNewDocument,
  onNewDocument,
  newDocumentLabel,
  newDocumentMenuLabel,
  session,
  onLogout,
  primaryItems,
  driveItems,
  drivesSectionLabel,
}: DocsHomeSidebarProps) {
  const settingsItem = useWorkspaceAppSettingsMenuItem("docs");
  // Without a primary button there is no menu for Settings: it is the first section's last row.
  const firstItems =
    !showNewDocument && settingsItem ? [...primaryItems, settingsItem] : primaryItems;
  return (
    <AppSidebar
      settingsAppId="docs"
      open={open}
      onCloseMobile={onCloseMobile}
      appSwitchDisabled={wgwIsGuestSession()}
      appSwitchSubtitle="Docs"
      primaryButton={
        showNewDocument ? (
          <SidebarSegmentedNewMenu
            mainLabel={newDocumentLabel}
            menuLabel={newDocumentMenuLabel}
            onMainAction={onNewDocument}
          />
        ) : undefined
      }
      footer={<WorkspaceSidebarAccountFooter session={session} onLogout={onLogout} />}
    >
      <SidebarSection items={firstItems} />
      {driveItems.length > 0 ? (
        <SidebarSection title={drivesSectionLabel} items={driveItems} />
      ) : null}
    </AppSidebar>
  );
}
