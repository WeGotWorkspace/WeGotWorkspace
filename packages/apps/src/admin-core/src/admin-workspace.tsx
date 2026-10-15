import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
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
import { AdminRealtimeHealthPane } from "@/admin-core/src/admin-realtime-health-pane";
import { AdminSearchPane } from "@/admin-core/src/admin-search-pane";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { AdminWebRootProbe } from "@/admin-core/src/admin-web-root-probe";
import { AdminWorkspaceModals } from "@/admin-core/src/admin-workspace-modals";
import { appUrlFromBrowserLocation } from "@/admin-core/src/admin-workspace-utils";
import { cn } from "@/lib/utils";
import "@/admin-core/src/admin-workspace.css";

export function AdminSecurityWarnings({
  warnings,
  baseUri,
  onUseThisAddress,
}: {
  warnings: readonly string[];
  baseUri: string;
  onUseThisAddress?: (url: string) => Promise<boolean | void> | boolean | void;
}) {
  const [pending, setPending] = useState(false);
  const [appUrlSaved, setAppUrlSaved] = useState(false);
  const visibleWarnings = appUrlSaved
    ? warnings.filter((warning) => !warning.startsWith("APP_URL is not set"))
    : warnings;
  if (visibleWarnings.length === 0) {
    return null;
  }

  return (
    <div className="admin-security-warnings">
      {visibleWarnings.map((warning) => {
        const isAppUrl = warning.startsWith("APP_URL is not set");
        return (
          <Callout
            key={warning}
            severity="error"
            title="Security warning"
            message={warning}
            action={
              isAppUrl ? (
                <Button
                  label="Use this address"
                  variant="outline"
                  size="sm"
                  disabled={pending || onUseThisAddress == null}
                  onClick={() => {
                    if (onUseThisAddress == null) return;
                    const url = appUrlFromBrowserLocation(window.location.origin, baseUri);
                    setPending(true);
                    void Promise.resolve(onUseThisAddress(url))
                      .then((saved) => {
                        if (saved === true) setAppUrlSaved(true);
                      })
                      .finally(() => setPending(false));
                  }}
                />
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}

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
            sidebarOpen={controller.sidebarOpen}
            onToggleSidebar={() => controller.setSidebarOpen((value) => !value)}
          />
        }
        main={
          <>
            <AdminWebRootProbe />
            <AdminSecurityWarnings
              warnings={data.securityWarnings}
              baseUri={data.webdav.baseUri}
              onUseThisAddress={(url) => controller.actions.useThisAddress(url)}
            />
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
              />
            ) : null}
            {controller.section === "mail" ? <AdminMailPane controller={controller} /> : null}
            {controller.section === "email-delivery" ? (
              <AdminEmailDeliveryPane controller={controller} />
            ) : null}
            {controller.section === "collaboration" ? (
              <AdminRealtimeCollaborationPane controller={controller} />
            ) : null}
            {controller.section === "realtime-health" ? (
              <AdminRealtimeHealthPane
                onOpenTurnSettings={() => controller.selectSection("collaboration")}
              />
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
    </>
  );
}
