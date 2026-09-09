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
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import { SettingsOfflinePane } from "@/settings-core/src/settings-offline-pane";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsMailPane } from "@/settings-core/src/settings-mail-pane";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
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

function Sidebar({
  controller,
  session,
  onLogout,
}: {
  controller: SettingsControllerState;
  session: WorkspaceSession;
  onLogout?: () => void;
}) {
  const sidebarItems: MenuItemProps[] = controller.sections.map((candidate) => ({
    label: candidate.label,
    icon: candidate.icon,
    selected: controller.section === candidate.id,
    onClick: () => controller.selectSection(candidate.id),
  }));

  return (
    <AppSidebar
      footer={<MainFooter session={session} onLogout={onLogout} />}
      open={controller.sidebarOpen}
      onCloseMobile={() => controller.setSidebarOpen(false)}
    >
      <SidebarSection title="Account" items={sidebarItems} />
    </AppSidebar>
  );
}

function MainHeader({ controller }: { controller: SettingsControllerState }) {
  return (
    <ViewHeader
      title={controller.currentSection.label}
      subtitle={controller.currentSection.description}
      sidebarOpen={controller.sidebarOpen}
      onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
    />
  );
}

function MainContent({ controller }: { controller: SettingsControllerState }) {
  return (
    <>
      {controller.currentSection.id === "profile" ? (
        <SettingsProfilePane profile={controller.profile} />
      ) : null}
      {controller.currentSection.id === "memberships" ? (
        <SettingsMembershipsPane groups={controller.memberships} />
      ) : null}
      {controller.currentSection.id === "mail" ? <SettingsMailPane mail={controller.mail} /> : null}
      {controller.currentSection.id === "offline" ? <SettingsOfflinePane /> : null}
      {controller.currentSection.id === "assistants" ? (
        <SettingsAssistantsPane assistants={controller.assistants} />
      ) : null}
    </>
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
