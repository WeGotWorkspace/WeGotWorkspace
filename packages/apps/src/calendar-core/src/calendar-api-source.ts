import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import {
  createCalendarEventLive,
  createCalendarJmapClient,
  createCalendarLive,
  deleteCalendarEventLive,
  deleteCalendarLive,
  fetchCalendarBootstrapForClient,
  importEventsLive,
  patchCalendarEventLive,
  patchCalendarLive,
} from "@/lib/api/wgw/calendar";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapClient, MockJmapServer, type JmapCalendar } from "@/lib/jmap-client";
import {
  createHybridCalendarOperations,
  loadCalendarBootstrapHybrid,
} from "@/lib/offline/calendars-hybrid-operations";
import { resolveCalendarsOfflineUsername } from "@/lib/offline/offline-session";
import {
  calendarSharePrincipalsFromDirectory,
  filterCalendarSharePrincipals,
} from "@/calendar-core/src/calendar-share";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import { createMockCalendarIcsOperations } from "@/lib/api/mock/calendar-ics-operations";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type CalendarApiSource = {
  loadBootstrap: () => Promise<CalendarAppBootstrap>;
  createOperations: (bootstrap?: CalendarAppBootstrap) => CalendarAPIOperations | undefined;
  /** Inbound JMAP client (undefined = no live `/changes` poll). */
  createJmapClient?: () => JmapClient;
};

const MOCK_SHARE_INVITEES: CalendarInvitee[] = [
  { username: "alice", email: "alice@example.test", name: "Alice" },
  { username: "bob", email: "bob@example.test", name: "Bob" },
  { username: "carol", email: "carol@example.test", name: "Carol" },
];

export const MOCK_CALENDAR_CONTACT_CARDS: ContactCard[] = [
  {
    "@type": "Card",
    version: "1.0",
    id: "card-jane-host",
    uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440210",
    addressBookIds: { default: true },
    name: { "@type": "Name", isOrdered: false, full: "Jane Host" },
    emails: {
      "550e8400-e29b-41d4-a716-446655440211": {
        "@type": "EmailAddress",
        address: "Jane@Host",
        contexts: { work: true },
      },
      "550e8400-e29b-41d4-a716-446655440212": {
        "@type": "EmailAddress",
        address: "jane.home@host",
        contexts: { home: true },
      },
    },
  },
] as unknown as ContactCard[];

const FULL_RIGHTS = {
  mayReadFreeBusy: true,
  mayReadItems: true,
  mayWriteAll: true,
  mayWriteOwn: true,
  mayUpdatePrivate: true,
  mayRSVP: true,
  mayShare: false,
  mayDelete: true,
};

/**
 * Mock mode runs the vendored MockJmapServer seeded from the mock bootstrap,
 * so stories and the mock route exercise the exact same jmap paths (and the
 * same adapter-driven drag interactions) as the live app.
 */
function createMockJmapServer(): MockJmapServer {
  const server = new MockJmapServer();
  const bootstrap = createCalendarAppBootstrap();
  for (const calendar of bootstrap.data.calendars) {
    server.seedCalendar({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      isDefault: calendar.isDefault === true,
      isVisible: calendar.isVisible !== false,
      myRights: {
        ...FULL_RIGHTS,
        mayWriteAll: calendar.mayWrite !== false,
        mayWriteOwn: calendar.mayWrite !== false,
        mayShare: calendar.mayShare === true,
        mayDelete: calendar.mayDelete !== false,
      },
      ...(typeof calendar.sortOrder === "number" ? { sortOrder: calendar.sortOrder } : {}),
      ...(calendar.scope ? { scope: calendar.scope } : {}),
      ...(calendar.groupSlug ? { groupSlug: calendar.groupSlug } : {}),
      ...(calendar.subscriptionId ? { subscriptionId: calendar.subscriptionId } : {}),
      ...(calendar.shareWith !== undefined
        ? { shareWith: calendar.shareWith as JmapCalendar["shareWith"] }
        : {}),
    } as JmapCalendar);
  }
  for (const event of bootstrap.data.events) {
    server.seedEvent(event);
  }
  return server;
}

/** Live source: jmap bootstrap + Dexie cache + hybrid (online/queued) writes. */
export function createHybridCalendarApiSource(): CalendarApiSource {
  return {
    loadBootstrap: loadCalendarBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveCalendarsOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      return createHybridCalendarOperations(username);
    },
    // The adapter gets its own client — see createCalendarJmapClient's note
    // on JmapClient sync-state tracking.
    createJmapClient: createCalendarJmapClient,
  };
}

export function createMockCalendarApiSource(): CalendarApiSource {
  const server = createMockJmapServer();
  const clientFor = () => new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch });
  const opsClient = clientFor();
  return {
    loadBootstrap: () => fetchCalendarBootstrapForClient(opsClient, mockWorkspaceSession),
    createOperations: () => ({
      createEvent: (draft) => createCalendarEventLive(draft, opsClient),
      patchEvent: (eventId, patch) => patchCalendarEventLive(eventId, patch, opsClient),
      deleteEvent: (eventId) => deleteCalendarEventLive(eventId, opsClient),
      importEvents: (icsText, opts) => importEventsLive(icsText, opts),
      createCalendar: (draft) => createCalendarLive(draft, opsClient),
      patchCalendar: (calendarId, patch) => patchCalendarLive(calendarId, patch, opsClient),
      deleteCalendar: (calendarId) => deleteCalendarLive(calendarId, opsClient),
      ...createMockCalendarIcsOperations(),
      listSchedulingNotifications: async () => [],
      listInvitees: async () => ({
        list: MOCK_SHARE_INVITEES,
        canSubmitEmail: true,
      }),
      searchSharePrincipals: async (query) =>
        filterCalendarSharePrincipals(
          query,
          calendarSharePrincipalsFromDirectory({
            invitees: MOCK_SHARE_INVITEES,
            groups: createCalendarAppBootstrap().data.groups,
          }),
        ),
      respondSchedulingNotification: async () => {},
      dismissSchedulingNotification: async () => {},
    }),
    // Separate client for the adapter — independent sync-state tracking.
    createJmapClient: clientFor,
  };
}

export function createDefaultCalendarApiSource(): CalendarApiSource {
  return createWorkspaceSource<CalendarApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: createMockCalendarApiSource,
    createLiveSource: createHybridCalendarApiSource,
  });
}
