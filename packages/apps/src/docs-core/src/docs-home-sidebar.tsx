import { Plus } from "lucide-react";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";

export type DocsHomeSidebarProps = {
  open: boolean;
  onCloseMobile: () => void;
  showNewDocument: boolean;
  onNewDocument: () => void;
  newDocumentLabel: string;
  /** More ways to make a Doc, such as Import Word file (#1619). Empty: a plain button. */
  newDocumentMenuItems?: readonly DropdownMenuItemProps[];
  newDocumentMenuLabel?: string;
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
  newDocumentMenuItems = [],
  newDocumentMenuLabel = "",
  session,
  onLogout,
  primaryItems,
  driveItems,
  drivesSectionLabel,
}: DocsHomeSidebarProps) {
  return (
    <AppSidebar
      open={open}
      onCloseMobile={onCloseMobile}
      appSwitchDisabled={wgwIsGuestSession()}
      appSwitchSubtitle="Docs"
      primaryButton={
        showNewDocument && newDocumentMenuItems.length > 0 ? (
          <SidebarSegmentedNewMenu
            mainLabel={newDocumentLabel}
            menuLabel={newDocumentMenuLabel}
            onMainAction={onNewDocument}
            items={newDocumentMenuItems}
          />
        ) : showNewDocument ? (
          <Button
            label={newDocumentLabel}
            icon={<Plus />}
            size="md"
            pill
            variant="primary"
            onClick={onNewDocument}
          />
        ) : undefined
      }
      footer={<WorkspaceAppSettingsFooter appId="docs" session={session} onLogout={onLogout} />}
    >
      <SidebarSection items={primaryItems} />
      {driveItems.length > 0 ? (
        <SidebarSection title={drivesSectionLabel} items={driveItems} />
      ) : null}
    </AppSidebar>
  );
}
