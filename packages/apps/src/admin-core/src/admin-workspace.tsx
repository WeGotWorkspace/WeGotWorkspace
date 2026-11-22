import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { WorkspacePageHeader, WorkspacePageTrail } from "@/workspace-shell/src/workspace-page";
import { ViewHeader } from "@/view-header/src/view-header";
import { useAdminController } from "@/admin-core/src/use-admin-controller";
import { useDocumentTitle } from "@/lib/document-title";
import { isPageSecureContext } from "@/lib/secure-context";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import { AdminBackupsPane } from "@/admin-core/src/admin-backups-pane";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import {
  AdminHealthPane,
  adminHealthIssueCount,
  adminSecurityChecks,
} from "@/admin-core/src/admin-health-pane";
import { AdminUpdatesPane } from "@/admin-core/src/admin-updates-pane";
import { AdminUsersPane } from "@/admin-core/src/admin-users-pane";
import { AdminRealtimeCollaborationPane } from "@/admin-core/src/admin-realtime-collaboration-pane";
import { AdminSearchPane } from "@/admin-core/src/admin-search-pane";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { useWebRootProbe } from "@/admin-core/src/admin-web-root-probe";
import { AdminPageStatus } from "@/admin-core/src/admin-page-status";
import { AdminWorkspaceModals } from "@/admin-core/src/admin-workspace-modals";
import { ADMIN_GROUP_LABELS, ADMIN_GROUP_ORDER } from "@/admin-core/src/use-admin-sidebar-model";
import { ADMIN_DEFAULT_SECTION } from "@/admin-core/src/admin-section";
import { cn } from "@/lib/utils";
import { AutosaveStatusProvider, AutosaveStatusTag } from "@/ui/autosave-status";
import { AdminSettingsAutosave } from "@/admin-core/src/use-admin-settings-autosave";
import "@/admin-core/src/admin-workspace.css";

export function AdminWorkspace(props: AdminWorkspaceProps) {
  const { data, session, className, onLogout, section, initialSection, onSectionChange } = props;
  const controller = useAdminController({
    data,
    operations: props.operations,
    section,
    initialSection,
    onSectionChange,
  });

  useDocumentTitle(controller.currentSection.label);

  const secureContext = props.secureContext ?? isPageSecureContext();
  const reachableDirectories = useWebRootProbe();
  const securityChecks = adminSecurityChecks({
    warnings: controller.securityWarnings,
    secureContext,
    reachableDirectories,
    baseUri: data.webdav.baseUri,
  });
  const healthIssues = adminHealthIssueCount(securityChecks);

  const sidebarGroups = ADMIN_GROUP_ORDER.map((group) => ({
    group,
    items: controller.sections
      .filter((candidate) => candidate.group === group)
      .map((candidate) => ({
        label: candidate.label,
        icon: candidate.icon,
        selected: controller.section === candidate.id,
        badge: candidate.id === "health" && healthIssues > 0 ? healthIssues : undefined,
        onClick: () => controller.selectSection(candidate.id),
      })),
  })).filter((entry) => entry.items.length > 0);

  const groupMemberCount = useMemo(() => {
    const map = new Map<string, number>();
    controller.groups.forEach((group) => map.set(group.id, 0));
    controller.users.forEach((user) => {
      user.groups.forEach((groupId) => {
        map.set(groupId, (map.get(groupId) ?? 0) + 1);
      });
    });
    return map;
  }, [controller.groups, controller.users]);

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [confirmClearLogsOpen, setConfirmClearLogsOpen] = useState(false);
  const [confirmUpdateOpen, setConfirmUpdateOpen] = useState(false);
  const [updatingNow, setUpdatingNow] = useState(false);

  const editingUser = controller.users.find((user) => user.id === editUserId) ?? null;
  const passwordUser = controller.users.find((user) => user.id === passwordUserId) ?? null;
  const editingGroup = controller.groups.find((group) => group.id === editGroupId) ?? null;
  const deletingGroup = controller.groups.find((group) => group.id === deleteGroupId) ?? null;

  useEffect(() => {
    if (controller.updates.inProgress && confirmUpdateOpen) {
      setConfirmUpdateOpen(false);
      setUpdatingNow(false);
    }
  }, [controller.updates.inProgress, confirmUpdateOpen]);

  return (
    <AutosaveStatusProvider>
      <WorkspaceAppLayout
        className={cn("admin-workspace", className)}
        sidebar={
          <AppSidebar
            open={controller.sidebarOpen}
            onCloseMobile={() => controller.setSidebarOpen(false)}
            footer={
              <WorkspaceUserFooter
                name={session.user.displayName}
                initials={workspaceUserInitials(session.user)}
                detailLine={session.user.username}
                onLogoutClick={onLogout}
              />
            }
          >
            {sidebarGroups.map((entry) => (
              <SidebarSection
                key={entry.group}
                title={ADMIN_GROUP_LABELS[entry.group]}
                items={entry.items}
              />
            ))}
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            title={ADMIN_GROUP_LABELS[controller.currentSection.group]}
            titlePrefix={
              <WorkspacePageTrail
                label="Admin"
                path={ADMIN_DEFAULT_SECTION}
                onNavigate={() => controller.selectSection(ADMIN_DEFAULT_SECTION)}
              />
            }
            sidebarOpen={controller.sidebarOpen}
            onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
          />
        }
        main={
          <AdminSettingsAutosave controller={controller}>
            <WorkspacePageHeader
              title={controller.currentSection.label}
              description={controller.currentSection.description}
              status={
                <>
                  {/* Keyed by page: a Saved from the previous page does not show here. The
                      page's own state comes last, on the column edge. */}
                  <AutosaveStatusTag key={controller.section} />
                  <AdminPageStatus controller={controller} />
                </>
              }
            />
            {controller.section === "health" ? (
              <AdminHealthPane controller={controller} securityChecks={securityChecks} />
            ) : null}
            {controller.section === "users" ? (
              <AdminUsersPane
                controller={controller}
                groupMemberCount={groupMemberCount}
                onNewUser={() => setNewUserOpen(true)}
                onEditUser={setEditUserId}
                onPasswordUser={setPasswordUserId}
                onNewGroup={() => setNewGroupOpen(true)}
                onEditGroup={setEditGroupId}
                onDeleteGroup={setDeleteGroupId}
                projectOperations={props.projectOperations}
              />
            ) : null}
            {controller.section === "email-delivery" ? (
              <AdminEmailDeliveryPane controller={controller} />
            ) : null}
            {controller.section === "collaboration" ? (
              <AdminRealtimeCollaborationPane controller={controller} />
            ) : null}
            {controller.section === "webdav" ? <AdminWebdavPane controller={controller} /> : null}
            {controller.section === "backups" ? <AdminBackupsPane controller={controller} /> : null}
            {controller.section === "updates" ? (
              <AdminUpdatesPane
                controller={controller}
                setConfirmClearLogsOpen={setConfirmClearLogsOpen}
                setConfirmUpdateOpen={setConfirmUpdateOpen}
                updatingNow={updatingNow}
              />
            ) : null}
            {controller.section === "search" ? <AdminSearchPane controller={controller} /> : null}
            {controller.section === "mcp" ? (
              <AdminMcpPane
                controller={controller}
                mcpEndpointUrl={data.mcp.endpointUrl ?? undefined}
              />
            ) : null}
          </AdminSettingsAutosave>
        }
      />

      <AdminWorkspaceModals
        data={data}
        session={session}
        controller={controller}
        newUserOpen={newUserOpen}
        setNewUserOpen={setNewUserOpen}
        setEditUserId={setEditUserId}
        setPasswordUserId={setPasswordUserId}
        newGroupOpen={newGroupOpen}
        setNewGroupOpen={setNewGroupOpen}
        setEditGroupId={setEditGroupId}
        setDeleteGroupId={setDeleteGroupId}
        confirmClearLogsOpen={confirmClearLogsOpen}
        setConfirmClearLogsOpen={setConfirmClearLogsOpen}
        confirmUpdateOpen={confirmUpdateOpen}
        setConfirmUpdateOpen={setConfirmUpdateOpen}
        updatingNow={updatingNow}
        setUpdatingNow={setUpdatingNow}
        editingUser={editingUser}
        passwordUser={passwordUser}
        editingGroup={editingGroup}
        deletingGroup={deletingGroup}
      />
    </AutosaveStatusProvider>
  );
}
