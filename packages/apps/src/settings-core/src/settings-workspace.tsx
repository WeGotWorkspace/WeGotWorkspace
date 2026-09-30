import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import {
  useSettingsController,
  type SettingsControllerState,
} from "@/settings-core/src/use-settings-controller";
import { useDocumentTitle } from "@/lib/document-title";
import { reachabilityFromSettingsData } from "@/settings-core/src/settings-reachability";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import { cn } from "@/lib/utils";
import "@/settings-core/src/settings-workspace.css";

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const {
    data,
    session,
    operations,
    section,
    initialSection,
    onSectionChange,
    className,
    onLogout,
  } = props;
  const controller = useSettingsController({
    data,
    operations,
    section,
    initialSection,
    onSectionChange,
  });

  useDocumentTitle(controller.currentSection.label);

  return (
    <WorkspaceAppLayout
      className={cn("settings-workspace", className)}
      sidebar={<Sidebar controller={controller} session={session} onLogout={onLogout} />}
      mainHeader={<MainHeader controller={controller} />}
      main={<MainContent controller={controller} />}
    />
  );
}

function navItems(
  controller: SettingsControllerState,
  panels: SettingsControllerState["sidebarGroups"]["account"],
): MenuItemProps[] {
  return panels.map((candidate) => ({
    label: candidate.label,
    icon: candidate.icon,
    selected: controller.section === candidate.id,
    onClick: () => controller.selectSection(candidate.id),
  }));
}

function Sidebar({
  controller,
  session,
  onLogout,
}: {
  controller: SettingsControllerState;
  session: WorkspaceSession;
  onLogout?: () => void;
}) {
  const accountItems = navItems(controller, controller.sidebarGroups.account);
  const appsItems = navItems(controller, controller.sidebarGroups.apps);

  return (
    <AppSidebar
      footer={<MainFooter session={session} onLogout={onLogout} />}
      open={controller.sidebarOpen}
      onCloseMobile={() => controller.setSidebarOpen(false)}
    >
      {accountItems.length > 0 ? <SidebarSection title="Account" items={accountItems} /> : null}
      {appsItems.length > 0 ? <SidebarSection title="Apps" items={appsItems} /> : null}
    </AppSidebar>
  );
}

function MainHeader({ controller }: { controller: SettingsControllerState }) {
  return (
    <ViewHeader
      title={controller.currentSection.label}
      sidebarOpen={controller.sidebarOpen}
      onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
    />
  );
}

function MainContent({ controller }: { controller: SettingsControllerState }) {
  return (
    <SettingsPanelHost
      panelId={controller.section}
      ctx={reachabilityFromSettingsData({ mcpEnabled: controller.mcpEnabled })}
      slices={{
        profile: controller.profile,
        mail: controller.mail,
        assistants: controller.assistants,
        memberships: controller.memberships,
      }}
    />
  );
}

function MainFooter({ session, onLogout }: { session: WorkspaceSession; onLogout?: () => void }) {
  return (
    <WorkspaceUserFooter
      name={session.user.displayName}
      initials={workspaceUserInitials(session.user)}
      detailLine={session.user.username}
      onLogoutClick={onLogout}
    />
  );
}
