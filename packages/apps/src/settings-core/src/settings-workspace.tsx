import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUP_ORDER,
} from "@/settings-core/src/use-settings-sidebar-model";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { WorkspacePageHeader, WorkspacePageTrail } from "@/workspace-shell/src/workspace-page";
import { SETTINGS_DEFAULT_SECTION } from "@/settings-core/src/settings-section";
import {
  useSettingsController,
  type SettingsControllerState,
} from "@/settings-core/src/use-settings-controller";
import { useState } from "react";
import { useDocumentTitle } from "@/lib/document-title";
import { reachabilityFromSettingsData } from "@/settings-core/src/settings-reachability";
import { SettingsPanelHost } from "@/settings-core/src/settings-panel-host";
import type { SettingsWorkspaceProps } from "@/settings-core/src/settings-workspace-props";
import { cn } from "@/lib/utils";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import { SettingsPageStatusSlotContext } from "@/settings-core/src/settings-page-status";
import "@/settings-core/src/settings-workspace.css";

/** Sidebar section titles; also the header title (Settings › Device). */

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
  return (
    <AppSidebar
      footer={<MainFooter session={session} onLogout={onLogout} />}
      open={controller.sidebarOpen}
      onCloseMobile={() => controller.setSidebarOpen(false)}
    >
      {SETTINGS_GROUP_ORDER.map((group) => {
        const items = navItems(controller, controller.sidebarGroups[group]);
        return items.length > 0 ? (
          <SidebarSection key={group} title={SETTINGS_GROUP_LABELS[group]} items={items} />
        ) : null;
      })}
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
      title={SETTINGS_GROUP_LABELS[panel.group]}
      titlePrefix={
        <WorkspacePageTrail
          label="Settings"
          path={SETTINGS_DEFAULT_SECTION}
          onNavigate={() => controller.selectSection(SETTINGS_DEFAULT_SECTION)}
        />
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
  // A pane may show its own state tag here (`SettingsPageStatus`).
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <WorkspacePageHeader
        title={pageTitle(panel)}
        description={panel.description}
        status={
          <>
            {/* Keyed by pane: a Saved from the previous pane does not show on the next one. */}
            <AutosaveStatusTag key={panel.id} />
            <span ref={setStatusSlot} className="settings-page-header__slot" />
          </>
        }
      />
      <SettingsPageStatusSlotContext.Provider value={statusSlot}>
        <SettingsPanelHost
          panelId={controller.section}
          ctx={reachabilityFromSettingsData({ mcpEnabled: controller.mcpEnabled })}
          slices={{
            profile: controller.profile,
            assistants: controller.assistants,
            memberships: controller.memberships,
          }}
        />
      </SettingsPageStatusSlotContext.Provider>
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
