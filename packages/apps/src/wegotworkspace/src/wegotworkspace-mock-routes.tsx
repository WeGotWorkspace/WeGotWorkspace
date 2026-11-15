import { useMemo } from "react";
import { WeGotWorkspaceHome } from "@/wegotworkspace/src/wegotworkspace-home";
import type { RouterHistory } from "@tanstack/react-router";
import { useAdminRouteSync } from "@/admin-core/src/use-admin-route-sync";
import { AdminWorkspace } from "@/admin-core/src/admin-workspace";
import { CalendarApp } from "@/calendar-core/src/calendar-app";
import { ContactsWorkspace } from "@/contacts-core/src/contacts-workspace";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { InstallerWorkspace } from "@/installer-core/src/installer-workspace";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import { createInstallerWorkspaceStoryArgs } from "@/lib/api/mock/installer-bootstrap";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { useNotesRouteSync } from "@/notes-core/src/use-notes-route-sync";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";
import { useSettingsRouteSync } from "@/settings-core/src/use-settings-route-sync";
import { createDefaultTasksApiSource } from "@/tasks-core/src/tasks-api-source";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { useTasksRouteSync } from "@/tasks-core/src/use-tasks-route-sync";
import {
  createWeGotWorkspaceRouter,
  type WeGotWorkspaceMockRoutes,
} from "@/wegotworkspace/src/wegotworkspace-routes";
import { useWeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-story-logout";

/*
 * Demo routes for the mock shell (Storybook, route tests). Only
 * `wegotworkspace.tsx` and tests import this file, so the production entry
 * (`main.tsx` → live router) never pulls demo data into its bundle (#1628).
 */

function MockDocsRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createDocsAppBootstrap(), []);
  return <DocsWorkspace data={bootstrap.data} session={bootstrap.session} onLogout={onLogout} />;
}

function MockNotesRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createNotesAppBootstrap(), []);
  const { initialView, initialNoteId, handleViewChange, handleNoteChange } = useNotesRouteSync();
  return (
    <NotesWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      listLoading={false}
      onLogout={onLogout}
      initialView={initialView}
      initialNoteId={initialNoteId}
      onViewChange={handleViewChange}
      onNoteChange={handleNoteChange}
    />
  );
}

function MockDriveRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createDriveAppBootstrap(), []);
  return (
    <DriveWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      listLoading={false}
      onLogout={onLogout}
    />
  );
}

function MockSettingsRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createSettingsAppBootstrap(), []);
  const { section, onSectionChange } = useSettingsRouteSync(bootstrap.data.mcpEnabled);
  return (
    <SettingsWorkspace
      {...bootstrap}
      section={section}
      onSectionChange={onSectionChange}
      onLogout={onLogout}
    />
  );
}

function MockMeetRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  return <MeetWorkspace data={bootstrap.data} session={bootstrap.session} onLogout={onLogout} />;
}

function MockContactsRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createContactsAppBootstrap(), []);
  return (
    <ContactsWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      listLoading={false}
      onLogout={onLogout}
    />
  );
}

function MockTasksRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createTasksAppBootstrap(), []);
  const { initialView, initialTaskId, handleViewChange } = useTasksRouteSync();
  const operations = useMemo(
    () => createDefaultTasksApiSource().createOperations(bootstrap),
    [bootstrap],
  );
  return (
    <TasksWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      operations={operations}
      listRefreshing={false}
      onLogout={onLogout}
      initialView={initialView}
      initialTaskId={initialTaskId}
      onViewChange={handleViewChange}
    />
  );
}

// The default calendar source resolves to the MockJmapServer-backed source in
// mock mode, so the mock route runs the full adapter-driven app.
function MockCalendarRoute() {
  return <CalendarApp />;
}

function MockAdminRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createAdminAppBootstrap(), []);
  const { section, onSectionChange } = useAdminRouteSync();
  return (
    <AdminWorkspace
      {...bootstrap}
      section={section}
      onSectionChange={onSectionChange}
      onLogout={onLogout}
    />
  );
}

function MockInstallerRoute() {
  const bootstrap = useMemo(() => createInstallerWorkspaceStoryArgs(), []);
  return <InstallerWorkspace {...bootstrap} />;
}

export const wegotworkspaceMockRoutes: WeGotWorkspaceMockRoutes = {
  home: WeGotWorkspaceHome,
  notes: MockNotesRoute,
  drive: MockDriveRoute,
  docs: MockDocsRoute,
  settings: MockSettingsRoute,
  meet: MockMeetRoute,
  admin: MockAdminRoute,
  contacts: MockContactsRoute,
  tasks: MockTasksRoute,
  calendar: MockCalendarRoute,
  installer: MockInstallerRoute,
};

/** Mock-mode router with demo data, for the mock shell and route tests. */
export function createMockWeGotWorkspaceRouter(history: RouterHistory) {
  return createWeGotWorkspaceRouter({
    mode: "mock",
    history,
    mockRoutes: wegotworkspaceMockRoutes,
  });
}
