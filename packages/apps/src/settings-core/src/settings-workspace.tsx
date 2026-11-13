import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ChevronRight } from "lucide-react";
import { ViewHeader } from "@/view-header/src/view-header";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import { SETTINGS_DEFAULT_SECTION } from "@/settings-core/src/settings-section";
import {
  useSettingsController,
  type SettingsControllerState,
} from "@/settings-core/src/use-settings-controller";
import { useDocumentTitle } from "@/lib/document-title";
import { reachabilityFromSettingsData } from "@/settings-core/src/settings-reachability";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import { cn } from "@/lib/utils";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import "@/settings-core/src/settings-workspace.css";

/** Sidebar section titles; also the header title (Settings › Device). */
const GROUP_LABELS = { account: "Account", device: "Device", apps: "Apps" } as const;

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

  // Panes autosave, as in the Settings dialog: the page title row shows the same Saving / Saved tag.
  return (
    <AutosaveStatusProvider>
      <WorkspaceAppLayout
        className={cn("settings-workspace", className)}
        sidebar={<Sidebar controller={controller} session={session} onLogout={onLogout} />}
        mainHeader={<MainHeader controller={controller} />}
        main={<MainContent controller={controller} />}
      />
    </AutosaveStatusProvider>
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
  const deviceItems = navItems(controller, controller.sidebarGroups.device);
  const appsItems = navItems(controller, controller.sidebarGroups.apps);

  return (
    <AppSidebar
      footer={<MainFooter session={session} onLogout={onLogout} />}
      open={controller.sidebarOpen}
      onCloseMobile={() => controller.setSidebarOpen(false)}
    >
      {accountItems.length > 0 ? (
        <SidebarSection title={GROUP_LABELS.account} items={accountItems} />
      ) : null}
      {deviceItems.length > 0 ? (
        <SidebarSection title={GROUP_LABELS.device} items={deviceItems} />
      ) : null}
      {appsItems.length > 0 ? <SidebarSection title={GROUP_LABELS.apps} items={appsItems} /> : null}
    </AppSidebar>
  );
}

/**
 * Settings › Apps: the group is the header title. The pane's own name is the page title
 * below, so the header does not repeat it.
 */
function MainHeader({ controller }: { controller: SettingsControllerState }) {
  const panel = controller.currentSection;
  return (
    <ViewHeader
      title={GROUP_LABELS[panel.group]}
      titlePrefix={
        <span className="settings-main-header__trail">
          <PathBreadcrumb
            items={[{ label: "Settings", path: SETTINGS_DEFAULT_SECTION }]}
            currentPath={panel.id}
            alwaysNavigablePaths={[SETTINGS_DEFAULT_SECTION]}
            onNavigate={() => controller.selectSection(SETTINGS_DEFAULT_SECTION)}
          />
          <ChevronRight className="settings-main-header__trail-separator" aria-hidden />
        </span>
      }
      sidebarOpen={controller.sidebarOpen}
      onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
    />
  );
}

/** "Calendar settings" for an app; account panes keep their own name ("Profile"). */
function pageTitle(panel: SettingsControllerState["currentSection"]): string {
  return panel.group === "apps" ? `${panel.label} settings` : panel.label;
}

function MainContent({ controller }: { controller: SettingsControllerState }) {
  const panel = controller.currentSection;
  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header__title-row">
          <h1 className="settings-page-header__title">{pageTitle(panel)}</h1>
          {/* Keyed by pane: a Saved from the previous pane does not show on the next one. */}
          <AutosaveStatusTag key={panel.id} />
        </div>
        <p className="settings-page-header__description">{panel.description}</p>
      </header>
      <SettingsPanelHost
        panelId={controller.section}
        ctx={reachabilityFromSettingsData({ mcpEnabled: controller.mcpEnabled })}
        slices={{
          profile: controller.profile,
          assistants: controller.assistants,
          memberships: controller.memberships,
        }}
      />
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
