import { useMemo } from "react";
import {
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { AdminApp } from "@/admin-core/src/admin-app";
import { CalendarApp } from "@/calendar-core/src/calendar-app";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import { createDefaultCalendarApiSource } from "@/calendar-core/src/calendar-api-source";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { ContactsApp } from "@/contacts-core/src/contacts-app";
import { DocsApp } from "@/docs-core/src/docs-app";
import { validateDocsRouteSearch } from "@/docs-core/src/docs-route-search";
import { DriveApp } from "@/drive-core/src/drive-app";
import { validateDriveRouteSearch } from "@/drive-core/src/drive-route-search";
import { validateMeetRouteSearch } from "@/meet-core/src/meet-route-search";
import { InstallApp } from "@/install-core/src/install-app";
import { MailApp } from "@/mail-core/src/mail-app";
import { MeetApp } from "@/meet-core/src/meet-app";
import { createWgwMeetGuestApiSource } from "@/meet-core/src/meet-api-source";
import { NotesApp } from "@/notes-core/src/notes-app";
import { createDefaultTasksApiSource } from "@/tasks-core/src/tasks-api-source";
import { TasksApp } from "@/tasks-core/src/tasks-app";
import { INBOX_TASK_LIST_ID } from "@/tasks-core/src/tasks-task-utils";
import { SettingsApp } from "@/settings-core/src/settings-app";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import { createInstallWorkspaceStoryArgs } from "@/lib/api/mock/install-bootstrap";
import { createMailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { folderTokenFromMailboxLabel } from "@/lib/mail/folder-token";
import { AdminWorkspace } from "@/admin-core/src/admin-workspace";
import { ContactsWorkspace } from "@/contacts-core/src/contacts-workspace";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { InstallWorkspace } from "@/install-core/src/install-workspace";
import { MailWorkspace } from "@/mail-core/src/mail-workspace";
import { mailStoryLabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { MeetWorkspace } from "@/meet-core/src/meet-workspace";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { useNotesRouteSync } from "@/notes-core/src/use-notes-route-sync";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { useTasksRouteSync } from "@/tasks-core/src/use-tasks-route-sync";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";
import { WeGotWorkspaceHome } from "@/wegotworkspace/src/wegotworkspace-home";
import { WeGotWorkspaceLiveHome } from "@/wegotworkspace/src/wegotworkspace-live-home";
import {
  loginRouteBeforeLoad,
  WeGotWorkspaceLoginRoute,
  type LoginSearch,
} from "@/wegotworkspace/src/wegotworkspace-login-route";
import { WeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-logout";
import { withWeGotWorkspaceAuth } from "@/wegotworkspace/src/wegotworkspace-require-auth";
import { wegotworkspaceRootRoute } from "@/wegotworkspace/src/wegotworkspace-router-shared";
import { WeGotWorkspaceNotFound } from "@/wegotworkspace/src/wegotworkspace-shell";
import { useWeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-story-logout";
import { SharePublicRoute } from "@/share-ui/share-public-route";
import { createWorkspacePwaHead } from "@/lib/workspace-pwa-head";

export type WeGotWorkspaceRouteMode = "mock" | "live";

const homePwaHead = () => createWorkspacePwaHead("home");
const loginPwaHead = () =>
  createWorkspacePwaHead("home", {
    title: "Sign in — WeGotWorkspace",
    description: "Sign in to your workspace to continue.",
  });
const mailPwaHead = () => createWorkspacePwaHead("mail");
const notesPwaHead = () => createWorkspacePwaHead("notes");
const drivePwaHead = () => createWorkspacePwaHead("drive");
const docsPwaHead = () => createWorkspacePwaHead("docs");
const settingsPwaHead = () => createWorkspacePwaHead("settings");
const meetPwaHead = () => createWorkspacePwaHead("meet");
const meetGuestPwaHead = () =>
  createWorkspacePwaHead("meet", {
    title: "Join meeting",
    description: "Join a video meeting as a guest.",
  });
const sharePublicPwaHead = () =>
  createWorkspacePwaHead("docs", {
    title: "Shared link",
    description: "Open a document or folder shared with you.",
  });
const adminPwaHead = () => createWorkspacePwaHead("admin");
const contactsPwaHead = () => createWorkspacePwaHead("contacts");
const tasksPwaHead = () => createWorkspacePwaHead("tasks");
const calendarPwaHead = () => createWorkspacePwaHead("calendar");

const STORY_SYSTEM_MAILBOXES = [
  "Inbox",
  "Starred",
  "Sent",
  "Drafts",
  "Spam",
  "Archive",
  "Trash",
] as const;

const guestMeetSource = createWgwMeetGuestApiSource();

function MockMailRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createMailAppBootstrap(), []);
  return (
    <MailWorkspace
      messages={bootstrap.data.mail}
      mailboxes={bootstrap.data.mailboxes}
      session={bootstrap.session}
      labels={mailStoryLabels}
      listLoading={false}
      systemMailboxes={STORY_SYSTEM_MAILBOXES}
      encodeFolderToken={folderTokenFromMailboxLabel}
      onLogout={onLogout}
    />
  );
}

function MockDocsRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createDocsAppBootstrap(), []);
  return <DocsWorkspace data={bootstrap.data} session={bootstrap.session} onLogout={onLogout} />;
}

function MockNotesRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createNotesAppBootstrap(), []);
  const shareOperations = useMemo(() => createMockDriveShareOperations(), []);
  const { initialView, initialNoteId, handleViewChange, handleNoteChange } = useNotesRouteSync();
  return (
    <NotesWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      listLoading={false}
      shareOperations={shareOperations}
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
  return <SettingsWorkspace {...bootstrap} onLogout={onLogout} />;
}

function MockMeetRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createMeetAppBootstrap(), []);
  return (
    <MeetWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      listLoading={false}
      onLogout={onLogout}
    />
  );
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
  const { initialView, handleViewChange } = useTasksRouteSync();
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
      onViewChange={handleViewChange}
    />
  );
}

function MockCalendarRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createCalendarAppBootstrap(), []);
  const operations = useMemo(
    () => createDefaultCalendarApiSource().createOperations(bootstrap),
    [bootstrap],
  );
  return (
    <CalendarWorkspace
      data={bootstrap.data}
      session={bootstrap.session}
      operations={operations}
      listRefreshing={false}
      onLogout={onLogout}
    />
  );
}

function MockAdminRoute() {
  const onLogout = useWeGotWorkspaceLogout();
  const bootstrap = useMemo(() => createAdminAppBootstrap(), []);
  return <AdminWorkspace {...bootstrap} onLogout={onLogout} />;
}

function MockInstallRoute() {
  const bootstrap = useMemo(() => createInstallWorkspaceStoryArgs(), []);
  return <InstallWorkspace {...bootstrap} />;
}

function MeetGuestRoute() {
  return <MeetApp source={guestMeetSource} />;
}

function buildRouteTree(mode: WeGotWorkspaceRouteMode) {
  const isLive = mode === "live";
  const Home = isLive ? WeGotWorkspaceLiveHome : WeGotWorkspaceHome;

  const indexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/",
    head: homePwaHead,
    component: isLive ? withWeGotWorkspaceAuth(Home) : Home,
  });

  const loginRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/login",
    head: loginPwaHead,
    validateSearch: (search: Record<string, unknown>): LoginSearch => ({
      return: typeof search.return === "string" ? search.return : undefined,
    }),
    beforeLoad: loginRouteBeforeLoad,
    component: WeGotWorkspaceLoginRoute,
  });

  const logoutRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/logout",
    component: WeGotWorkspaceLogout,
  });

  const mailRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/mail",
    head: mailPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(MailApp) : MockMailRoute,
  });

  const NotesComponent = isLive ? withWeGotWorkspaceAuth(NotesApp) : MockNotesRoute;

  // Each notes path is a root-level route with its own component so `useParams` in
  // NotesApp resolves leaf params (noteId, notebookSlug, tagSlug) on direct page loads.
  const notesIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes",
    head: notesPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/notes/all" });
    },
  });

  const notesAllRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/all",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesAllNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/all/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesStarredRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/starred",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesStarredNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/starred/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesArchiveRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/archive",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesArchiveNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/archive/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesSharedWithMeRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/shared-with-me",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesSharedWithMeNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/shared-with-me/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesSharedNbRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/shared-nb/$sharedNbSlug",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesSharedNbNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/shared-nb/$sharedNbSlug/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesTagRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/tags/$tagSlug",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesTagNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/tags/$tagSlug/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesNotebookRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/$notebookSlug",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesNotebookNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/$notebookSlug/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const driveRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/drive",
    head: drivePwaHead,
    validateSearch: validateDriveRouteSearch,
    component: isLive ? withWeGotWorkspaceAuth(DriveApp) : MockDriveRoute,
  });

  const docsRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/docs",
    head: docsPwaHead,
    validateSearch: validateDocsRouteSearch,
    component: isLive ? withWeGotWorkspaceAuth(DocsApp) : MockDocsRoute,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/settings",
    head: settingsPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(SettingsApp) : MockSettingsRoute,
  });

  const meetRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet",
    head: meetPwaHead,
    validateSearch: validateMeetRouteSearch,
    component: isLive ? withWeGotWorkspaceAuth(MeetApp) : MockMeetRoute,
  });

  const meetGuestRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet/guest",
    head: meetGuestPwaHead,
    validateSearch: validateMeetRouteSearch,
    component: MeetGuestRoute,
  });

  const meetJoinRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet/join",
    head: meetGuestPwaHead,
    validateSearch: validateMeetRouteSearch,
    component: MeetGuestRoute,
  });

  const adminRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/admin",
    head: adminPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(AdminApp) : MockAdminRoute,
  });

  const ContactsComponent = isLive ? withWeGotWorkspaceAuth(ContactsApp) : MockContactsRoute;

  // Each contacts path is a root-level route with its own component so `useParams` in
  // ContactsApp resolves leaf params (contactId, groupCardId) on direct page loads.
  const contactsIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/contacts",
    head: contactsPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/contacts/all" });
    },
  });

  const contactsAllRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/contacts/all",
    head: contactsPwaHead,
    component: ContactsComponent,
  });

  const contactsAllContactRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/contacts/all/$contactId",
    head: contactsPwaHead,
    component: ContactsComponent,
  });

  const contactsGroupRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/contacts/groups/$groupCardId",
    head: contactsPwaHead,
    component: ContactsComponent,
  });

  const contactsGroupContactRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/contacts/groups/$groupCardId/$contactId",
    head: contactsPwaHead,
    component: ContactsComponent,
  });

  const TasksComponent = isLive ? withWeGotWorkspaceAuth(TasksApp) : MockTasksRoute;

  const tasksIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks",
    head: tasksPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/tasks/lists/$listId", params: { listId: INBOX_TASK_LIST_ID } });
    },
  });

  const tasksStateAllRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/state/all",
    head: tasksPwaHead,
    component: TasksComponent,
  });

  const tasksStateRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/state/$stateSlug",
    head: tasksPwaHead,
    component: TasksComponent,
  });

  const tasksTagRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/tags/$tagSlug",
    head: tasksPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/tasks/lists/$listId", params: { listId: INBOX_TASK_LIST_ID } });
    },
  });

  const tasksListRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/lists/$listId",
    head: tasksPwaHead,
    component: TasksComponent,
  });

  const tasksPriorityRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/priority/$prioritySlug",
    head: tasksPwaHead,
    component: TasksComponent,
  });

  const calendarRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar",
    head: calendarPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(CalendarApp) : MockCalendarRoute,
  });

  const installRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/install",
    head: homePwaHead,
    component: isLive ? InstallApp : MockInstallRoute,
  });

  const sharePublicRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/share/$token",
    head: sharePublicPwaHead,
    component: SharePublicRoute,
  });

  return wegotworkspaceRootRoute.addChildren([
    indexRoute,
    loginRoute,
    logoutRoute,
    mailRoute,
    notesIndexRoute,
    notesAllRoute,
    notesAllNoteRoute,
    notesStarredRoute,
    notesStarredNoteRoute,
    notesArchiveRoute,
    notesArchiveNoteRoute,
    notesSharedWithMeRoute,
    notesSharedWithMeNoteRoute,
    notesSharedNbRoute,
    notesSharedNbNoteRoute,
    notesTagRoute,
    notesTagNoteRoute,
    notesNotebookRoute,
    notesNotebookNoteRoute,
    driveRoute,
    docsRoute,
    settingsRoute,
    meetRoute,
    meetGuestRoute,
    meetJoinRoute,
    adminRoute,
    contactsIndexRoute,
    contactsAllRoute,
    contactsAllContactRoute,
    contactsGroupRoute,
    contactsGroupContactRoute,
    tasksIndexRoute,
    tasksStateAllRoute,
    tasksStateRoute,
    tasksTagRoute,
    tasksListRoute,
    tasksPriorityRoute,
    calendarRoute,
    installRoute,
    sharePublicRoute,
  ]);
}

export function createWeGotWorkspaceRouter({
  mode,
  history,
}: {
  mode: WeGotWorkspaceRouteMode;
  history: RouterHistory;
}): AnyRouter {
  return createRouter({
    routeTree: buildRouteTree(mode),
    history,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: WeGotWorkspaceNotFound,
  });
}
