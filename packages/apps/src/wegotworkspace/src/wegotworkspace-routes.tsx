import {
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  type AnyRouter,
  type RouteComponent,
  type RouterHistory,
} from "@tanstack/react-router";
import { validateCalendarRouteSearch } from "@/calendar-core/src/calendar-route-search";
import { validateDocsRouteSearch } from "@/docs-core/src/docs-route-search";
import { validateDriveRouteSearch } from "@/drive-core/src/drive-route-search";
import {
  meetRoomFromSearch,
  parseMeetRouteSearch,
  validateMeetRouteSearch,
} from "@/lib/meetings/meet-route-search";
import { MEET_MEETINGS_ROUTE } from "@/meet-core/src/meet-chat-route";
import { validateTasksRouteSearch } from "@/tasks-core/src/tasks-route-search";
import { WeGotWorkspaceLiveHome } from "@/wegotworkspace/src/wegotworkspace-live-home";
import {
  loginRouteBeforeLoad,
  WeGotWorkspaceForgotPasswordRoute,
  WeGotWorkspaceLoginRoute,
  WeGotWorkspaceResetPasswordRoute,
  type LoginSearch,
  type ResetPasswordSearch,
} from "@/wegotworkspace/src/wegotworkspace-login-route";
import { WeGotWorkspaceLogout } from "@/wegotworkspace/src/wegotworkspace-logout";
import { withWeGotWorkspaceAuth } from "@/wegotworkspace/src/wegotworkspace-require-auth";
import { wegotworkspaceRootRoute } from "@/wegotworkspace/src/wegotworkspace-router-shared";
import { WeGotWorkspaceNotFound } from "@/wegotworkspace/src/wegotworkspace-shell";
import { createWorkspacePwaHead } from "@/lib/workspace-pwa-head";

/*
 * Each app loads as its own chunk when one of its routes opens (#1628). The
 * shell, home and sign-in stay in the entry chunk. The router preloads a
 * lazy route's chunk before it renders, and the service worker precaches
 * every chunk, so apps still open offline after one online visit.
 */
const AdminApp = lazyRouteComponent(() => import("@/admin-core/src/admin-app"), "AdminApp");
const CalendarApp = lazyRouteComponent(
  () => import("@/calendar-core/src/calendar-app"),
  "CalendarApp",
);
const CalendarRsvpPage = lazyRouteComponent(
  () => import("@/calendar-core/src/calendar-rsvp-page"),
  "CalendarRsvpPage",
);
const ContactsApp = lazyRouteComponent(
  () => import("@/contacts-core/src/contacts-app"),
  "ContactsApp",
);
const DocsApp = lazyRouteComponent(() => import("@/docs-core/src/docs-app"), "DocsApp");
const DriveApp = lazyRouteComponent(() => import("@/drive-core/src/drive-app"), "DriveApp");
const InstallerApp = lazyRouteComponent(
  () => import("@/installer-core/src/installer-app"),
  "InstallerApp",
);
const MeetLiveRoute = lazyRouteComponent(
  () => import("@/wegotworkspace/src/wegotworkspace-meet-live-route"),
  "MeetLiveRoute",
);
const NotesApp = lazyRouteComponent(() => import("@/notes-core/src/notes-app"), "NotesApp");
const SettingsApp = lazyRouteComponent(
  () => import("@/settings-core/src/settings-app"),
  "SettingsApp",
);
const SharePublicRoute = lazyRouteComponent(
  () => import("@/share-ui/share-public-route"),
  "SharePublicRoute",
);
const TasksApp = lazyRouteComponent(() => import("@/tasks-core/src/tasks-app"), "TasksApp");

export type WeGotWorkspaceRouteMode = "mock" | "live";

/** Demo route components for mock mode (`wegotworkspace-mock-routes.tsx`). */
export type WeGotWorkspaceMockRoutes = Record<
  | "home"
  | "notes"
  | "drive"
  | "docs"
  | "settings"
  | "meet"
  | "admin"
  | "contacts"
  | "tasks"
  | "calendar"
  | "installer",
  RouteComponent
>;

const homePwaHead = () => createWorkspacePwaHead("home");
const loginPwaHead = () =>
  createWorkspacePwaHead("home", {
    title: "Sign in — WeGotWorkspace",
    description: "Sign in to your workspace to continue.",
  });
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

function buildRouteTree(mode: WeGotWorkspaceRouteMode, mockRoutes?: WeGotWorkspaceMockRoutes) {
  const isLive = mode === "live";
  if (!isLive && !mockRoutes) {
    throw new Error("Mock mode needs mockRoutes (see wegotworkspace-mock-routes.tsx).");
  }
  const mock = mockRoutes as WeGotWorkspaceMockRoutes;
  const Home = isLive ? WeGotWorkspaceLiveHome : mock.home;

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
      intent: typeof search.intent === "string" ? search.intent : undefined,
      error: typeof search.error === "string" ? search.error : undefined,
    }),
    beforeLoad: loginRouteBeforeLoad,
    component: () => <Outlet />,
  });

  const loginIndexRoute = createRoute({
    getParentRoute: () => loginRoute,
    path: "/",
    component: WeGotWorkspaceLoginRoute,
  });

  const loginForgotRoute = createRoute({
    getParentRoute: () => loginRoute,
    path: "forgot",
    component: WeGotWorkspaceForgotPasswordRoute,
  });

  const loginResetRoute = createRoute({
    getParentRoute: () => loginRoute,
    path: "reset",
    validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
      token: typeof search.token === "string" ? search.token : undefined,
    }),
    component: WeGotWorkspaceResetPasswordRoute,
  });

  const logoutRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/logout",
    component: WeGotWorkspaceLogout,
  });

  // Unshipped in v0.9. The service worker can serve index.html for /mail without
  // hitting the server 302, so the client router sends bookmarks and the Mail PWA home.
  const redirectMailHome = () => {
    throw redirect({ to: "/", replace: true });
  };

  const mailRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/mail",
    beforeLoad: redirectMailHome,
  });

  const mailSplatRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/mail/$",
    beforeLoad: redirectMailHome,
  });

  const NotesComponent = isLive ? withWeGotWorkspaceAuth(NotesApp) : mock.notes;

  // Each notes path is a root-level route with its own component so `useParams` in
  // NotesApp resolves leaf params (noteId, notebookId, tagSlug) on direct page loads.
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

  // Back-compat deep-link. Product path is Decision 16 collection-sidebar
  // (shared notebooks in the notebooks section), not a per-note inbox.
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
    path: "/notes/notebooks/$notebookId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const notesNotebookNoteRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/notes/notebooks/$notebookId/$noteId",
    head: notesPwaHead,
    component: NotesComponent,
  });

  const driveRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/drive",
    head: drivePwaHead,
    validateSearch: validateDriveRouteSearch,
    component: isLive ? withWeGotWorkspaceAuth(DriveApp) : mock.drive,
  });

  const docsRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/docs",
    head: docsPwaHead,
    validateSearch: validateDocsRouteSearch,
    component: isLive ? withWeGotWorkspaceAuth(DocsApp) : mock.docs,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/settings",
    head: settingsPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(SettingsApp) : mock.settings,
  });

  const settingsSectionRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/settings/$section",
    head: settingsPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(SettingsApp) : mock.settings,
  });

  const meetRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet",
    head: meetPwaHead,
    validateSearch: validateMeetRouteSearch,
    beforeLoad: ({ search, location }) => {
      const pathname = location.pathname;
      if (
        pathname.startsWith("/meet/meetings/") ||
        pathname.startsWith("/meet/channels/") ||
        pathname.startsWith("/meet/dms/")
      ) {
        return;
      }
      const parsed = parseMeetRouteSearch(search as Record<string, unknown>);
      const room = meetRoomFromSearch(parsed);
      if (!room) return;
      throw redirect({
        to: MEET_MEETINGS_ROUTE,
        params: { meetingId: room },
        search: {},
        replace: true,
      });
    },
    // Live: Slack-like workspace. Signed-in channel, DM, persisted meeting,
    // and ad-hoc room URLs stay on one MeetChatApp. The invite gate is only
    // the signed-out ad-hoc lobby. Channels, DMs, and saved meetings refuse guests.
    component: isLive ? MeetLiveRoute : mock.meet,
  });

  // Nested under /meet (already on UiStaticServer + FrontRoutingTest) so the
  // workspace stays mounted when switching conversations. Type lives in the
  // path: /meet/channels/{id} vs /meet/meetings/{id} vs /meet/dms/{peer}.
  // /meet/guest and /meet/join stay sibling root routes so they redirect
  // instead of matching `$legacyId`.
  const meetChannelsRoute = createRoute({
    getParentRoute: () => meetRoute,
    path: "channels/$channelId",
    head: meetPwaHead,
  });

  const meetMeetingsRoute = createRoute({
    getParentRoute: () => meetRoute,
    path: "meetings/$meetingId",
    head: meetPwaHead,
  });

  const meetDmsRoute = createRoute({
    getParentRoute: () => meetRoute,
    path: "dms/$peerId",
    head: meetPwaHead,
  });

  // Back-compat `/meet/{id}` so MeetChatApp stays mounted and can replace the
  // URL (`dm:alice` → /meet/dms/alice, `chat-…` → /meet/channels/{id}).
  const meetLegacyChannelRoute = createRoute({
    getParentRoute: () => meetRoute,
    path: "$legacyId",
    head: meetPwaHead,
  });

  const meetGuestRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet/guest",
    head: meetGuestPwaHead,
    validateSearch: validateMeetRouteSearch,
    beforeLoad: ({ search }) => {
      const parsed = parseMeetRouteSearch(search as Record<string, unknown>);
      const room = meetRoomFromSearch(parsed);
      if (room) {
        throw redirect({
          to: MEET_MEETINGS_ROUTE,
          params: { meetingId: room },
          search: {},
          replace: true,
        });
      }
      throw redirect({ to: "/meet", search, replace: true });
    },
  });

  const meetJoinRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/meet/join",
    head: meetGuestPwaHead,
    validateSearch: validateMeetRouteSearch,
    beforeLoad: ({ search }) => {
      const parsed = parseMeetRouteSearch(search as Record<string, unknown>);
      const room = meetRoomFromSearch(parsed);
      if (room) {
        throw redirect({
          to: MEET_MEETINGS_ROUTE,
          params: { meetingId: room },
          search: {},
          replace: true,
        });
      }
      throw redirect({ to: "/meet", search, replace: true });
    },
  });

  const adminRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/admin",
    head: adminPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(AdminApp) : mock.admin,
  });

  const adminSectionRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/admin/$section",
    head: adminPwaHead,
    component: isLive ? withWeGotWorkspaceAuth(AdminApp) : mock.admin,
  });

  const ContactsComponent = isLive ? withWeGotWorkspaceAuth(ContactsApp) : mock.contacts;

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

  const TasksComponent = isLive ? withWeGotWorkspaceAuth(TasksApp) : mock.tasks;

  const tasksIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks",
    head: tasksPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/tasks/state/all" });
    },
  });

  const tasksStateAllRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/state/all",
    head: tasksPwaHead,
    validateSearch: validateTasksRouteSearch,
    component: TasksComponent,
  });

  const tasksStateRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/state/$stateSlug",
    head: tasksPwaHead,
    validateSearch: validateTasksRouteSearch,
    component: TasksComponent,
  });

  const tasksTagRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/tags/$tagSlug",
    head: tasksPwaHead,
    beforeLoad: () => {
      throw redirect({ to: "/tasks/state/all" });
    },
  });

  const tasksListRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/lists/$listId",
    head: tasksPwaHead,
    validateSearch: validateTasksRouteSearch,
    component: TasksComponent,
  });

  const tasksPriorityRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/tasks/priority/$prioritySlug",
    head: tasksPwaHead,
    validateSearch: validateTasksRouteSearch,
    component: TasksComponent,
  });

  const CalendarComponent = isLive ? withWeGotWorkspaceAuth(CalendarApp) : mock.calendar;

  // Each calendar path is a root-level route with its own component so `useParams`
  // in CalendarApp resolves view/date on direct page loads (same as notes/tasks).
  const calendarRsvpRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/rsvp/$token",
    head: calendarPwaHead,
    component: CalendarRsvpPage,
  });

  const calendarIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const calendarViewDateRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/$view/$date",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const calendarViewRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/$view",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const calendarListIndexRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/list",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const calendarListViewRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/list/$view",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const calendarListViewDateRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/calendar/list/$view/$date",
    head: calendarPwaHead,
    component: CalendarComponent,
    validateSearch: validateCalendarRouteSearch,
  });

  const installRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/install",
    head: homePwaHead,
    component: isLive ? InstallerApp : mock.installer,
  });

  const sharePublicRoute = createRoute({
    getParentRoute: () => wegotworkspaceRootRoute,
    path: "/share/$token",
    head: sharePublicPwaHead,
    component: SharePublicRoute,
  });

  return wegotworkspaceRootRoute.addChildren([
    indexRoute,
    loginRoute.addChildren([loginIndexRoute, loginForgotRoute, loginResetRoute]),
    logoutRoute,
    mailRoute,
    mailSplatRoute,
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
    settingsSectionRoute,
    meetRoute.addChildren([
      meetChannelsRoute,
      meetMeetingsRoute,
      meetDmsRoute,
      meetLegacyChannelRoute,
    ]),
    meetGuestRoute,
    meetJoinRoute,
    adminRoute,
    adminSectionRoute,
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
    calendarRsvpRoute,
    calendarIndexRoute,
    calendarListViewDateRoute,
    calendarListViewRoute,
    calendarListIndexRoute,
    calendarViewDateRoute,
    calendarViewRoute,
    installRoute,
    sharePublicRoute,
  ]);
}

export function createWeGotWorkspaceRouter({
  mode,
  history,
  mockRoutes,
}: {
  mode: WeGotWorkspaceRouteMode;
  history: RouterHistory;
  /** Required in mock mode. The live app never imports the demo routes. */
  mockRoutes?: WeGotWorkspaceMockRoutes;
}): AnyRouter {
  return createRouter({
    routeTree: buildRouteTree(mode, mockRoutes),
    history,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: WeGotWorkspaceNotFound,
  });
}
