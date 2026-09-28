import { Plus } from "lucide-react";
import { Button } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";

export type DocsHomeSidebarProps = {
  open: boolean;
  onCloseMobile: () => void;
  showNewDocument: boolean;
  onNewDocument: () => void;
  newDocumentLabel: string;
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
        showNewDocument ? (
          <Button
            label={newDocumentLabel}
            icon={<Plus />}
            size="xl"
            pill
            variant="primary"
            className="w-full"
            onClick={onNewDocument}
          />
        ) : undefined
      }
      footer={
        <WorkspaceUserFooter
          name={session.user.displayName}
          initials={workspaceUserInitials(session.user)}
          detailLine={session.user.username}
          onLogoutClick={onLogout}
        />
      }
    >
      <SidebarSection items={primaryItems} />
      {driveItems.length > 0 ? (
        <SidebarSection title={drivesSectionLabel} items={driveItems} />
      ) : null}
    </AppSidebar>
  );
}
