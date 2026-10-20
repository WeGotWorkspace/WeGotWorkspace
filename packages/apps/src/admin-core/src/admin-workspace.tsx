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
import { AdminSearchPane } from "@/admin-core/src/admin-search-pane";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { AdminWebRootProbe } from "@/admin-core/src/admin-web-root-probe";
import { AdminWorkspaceModals } from "@/admin-core/src/admin-workspace-modals";
import {
  appUrlFromBrowserLocation,
  isLoopbackOrigin,
} from "@/admin-core/src/admin-workspace-utils";
import { cn } from "@/lib/utils";
import "@/admin-core/src/admin-workspace.css";

const APP_URL_WARNING_PREFIX = "APP_URL is not set";

export function AdminSecurityWarnings({
  warnings,
  baseUri,
  origin = window.location.origin,
  onUseThisAddress,
}: {
  /** From the latest admin state: a saved address clears the warning only once the server agrees. */
  warnings: readonly string[];
  baseUri: string;
  /** Browser origin; a prop so tests can pass a public one. */
  origin?: string;
  onUseThisAddress?: (url: string) => Promise<boolean | void> | boolean | void;
}) {
  const [pending, setPending] = useState(false);
  if (warnings.length === 0) {
    return null;
  }
  const url = appUrlFromBrowserLocation(origin, baseUri);
  // The server ignores a loopback APP_URL, so saving it would change nothing.
  const local = isLoopbackOrigin(origin);

  return (
    <div className="admin-security-warnings">
      {warnings.map((warning) => {
        const isAppUrl = warning.startsWith(APP_URL_WARNING_PREFIX);
        return (
          <Callout
            key={warning}
            severity="error"
            title="Security warning"
            message={
              isAppUrl && local ? (
                <>
                  <p>{warning}</p>
                  <p>
                    This page is open on {origin}, a local address that cannot be the site address.
                    Open Admin through the site&apos;s public address and set it there, or set
                    APP_URL on the server.
                  </p>
                </>
              ) : (
                warning
              )
            }
            action={
              isAppUrl && !local ? (
                <Button
                  label={`Use ${url}`}
                  variant="outline"
                  size="sm"
                  disabled={pending || onUseThisAddress == null}
                  onClick={() => {
                    if (onUseThisAddress == null) return;
                    setPending(true);
                    void Promise.resolve(onUseThisAddress(url)).finally(() => setPending(false));
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
              warnings={controller.securityWarnings}
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
