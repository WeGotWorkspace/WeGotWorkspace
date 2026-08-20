import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { useAdminController } from "@/admin-core/src/use-admin-controller";
import { useDocumentTitle } from "@/lib/document-title";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import { AdminBackupsPane } from "@/admin-core/src/admin-backups-pane";
import { AdminEmailDeliveryPane } from "@/admin-core/src/admin-email-delivery-pane";
import { AdminMailPane } from "@/admin-core/src/admin-mail-pane";
import { AdminUpdatesPane } from "@/admin-core/src/admin-updates-pane";
import { AdminUsersPane } from "@/admin-core/src/admin-users-pane";
import { AdminRealtimeCollaborationPane } from "@/admin-core/src/admin-realtime-collaboration-pane";
import { AdminPluginsPane } from "@/admin-core/src/admin-plugins-pane";
import { AdminSearchPane } from "@/admin-core/src/admin-search-pane";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { AdminWorkspaceModals } from "@/admin-core/src/admin-workspace-modals";
import { cn } from "@/lib/utils";
import "@/admin-core/src/admin-workspace.css";

export function AdminWorkspace(props: AdminWorkspaceProps) {
  const { data, session, className, onLogout } = props;
  const controller = useAdminController({ data, operations: props.operations });

  useDocumentTitle(controller.currentSection.label);

  const sidebarItems = controller.sections.map((candidate) => ({
    label: candidate.label,
    icon: candidate.icon,
    selected: controller.section === candidate.id,
    onClick: () => controller.selectSection(candidate.id),
  }));

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
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [confirmClearLogsOpen, setConfirmClearLogsOpen] = useState(false);
  const [confirmUpdateOpen, setConfirmUpdateOpen] = useState(false);
  const [updatingNow, setUpdatingNow] = useState(false);

  const editingUser = controller.users.find((user) => user.id === editUserId) ?? null;
  const passwordUser = controller.users.find((user) => user.id === passwordUserId) ?? null;
  const deletingUser = controller.users.find((user) => user.id === deleteUserId) ?? null;
  const editingGroup = controller.groups.find((group) => group.id === editGroupId) ?? null;
  const deletingGroup = controller.groups.find((group) => group.id === deleteGroupId) ?? null;

  useEffect(() => {
    if (controller.updates.inProgress && confirmUpdateOpen) {
      setConfirmUpdateOpen(false);
      setUpdatingNow(false);
    }
  }, [controller.updates.inProgress, confirmUpdateOpen]);

  return (
    <>
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
            <SidebarSection title="Administration" items={sidebarItems} />
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            title={controller.currentSection.label}
            subtitle={controller.currentSection.description}
            sidebarOpen={controller.sidebarOpen}
            onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
          />
        }
        main={
          <>
            {controller.section === "users" ? (
              <AdminUsersPane
                controller={controller}
                groupMemberCount={groupMemberCount}
                onNewUser={() => setNewUserOpen(true)}
                onEditUser={setEditUserId}
                onPasswordUser={setPasswordUserId}
                onDeleteUser={setDeleteUserId}
                onNewGroup={() => setNewGroupOpen(true)}
                onEditGroup={setEditGroupId}
                onDeleteGroup={setDeleteGroupId}
              />
            ) : null}
            {controller.section === "mail" ? <AdminMailPane controller={controller} /> : null}
            {controller.section === "email-delivery" ? (
              <AdminEmailDeliveryPane controller={controller} />
            ) : null}
            {controller.section === "collaboration" ? (
              <AdminRealtimeCollaborationPane controller={controller} />
            ) : null}
            {controller.section === "webdav" ? <AdminWebdavPane controller={controller} /> : null}
            {controller.section === "plugins" ? <AdminPluginsPane controller={controller} /> : null}
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
          </>
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
        setDeleteUserId={setDeleteUserId}
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
        deletingUser={deletingUser}
        editingGroup={editingGroup}
        deletingGroup={deletingGroup}
      />
    </>
  );
}
