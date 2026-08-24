import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import type {
  CalendarAPIOperations,
  CalendarFeedInfo,
  CalendarInfo,
  CalendarSubscriptionInfo,
} from "@/calendar-core/src/calendar-types";

type MockCalendarIcsState = {
  subscriptions: Map<string, CalendarSubscriptionInfo>;
  feeds: Map<string, CalendarFeedInfo>;
};

export function createMockCalendarIcsState(): MockCalendarIcsState {
  return {
    subscriptions: new Map([
      [
        "sub-holidays",
        {
          id: "sub-holidays",
          url: "https://feeds.example.test/holidays.ics",
          calendarId: "holidays",
          name: "US Holidays",
          color: "#8b5cf6",
          lastFetchedAt: "2033-01-12T08:00:00Z",
        },
      ],
    ]),
    feeds: new Map(),
  };
}

export function createMockCalendarIcsOperations(
  state: MockCalendarIcsState = createMockCalendarIcsState(),
): Pick<
  CalendarAPIOperations,
  | "subscribeCalendar"
  | "getCalendarSubscription"
  | "unsubscribeCalendar"
  | "refreshStaleCalendarSubscriptions"
  | "getCalendarFeed"
  | "publishCalendarFeed"
  | "unpublishCalendarFeed"
> {
  return {
    subscribeCalendar: async (draft) => {
      const id = `sub-${state.subscriptions.size + 1}`;
      const calendarId = `subscribed-${id}`;
      const subscription: CalendarSubscriptionInfo = {
        id,
        url: draft.url.replace(/^webcals?:/i, "https:"),
        calendarId,
        name: draft.name ?? null,
        color: draft.color ?? null,
        lastFetchedAt: "2033-01-12T12:00:00Z",
      };
      state.subscriptions.set(id, subscription);
      const groupSlug = draft.groupSlug?.trim() || null;
      const created: CalendarInfo = {
        id: calendarId,
        name: draft.name?.trim() || subscription.name?.trim() || "Subscribed calendar",
        color: draft.color?.trim() || DEFAULT_CALENDAR_COLOR,
        mayWrite: false,
        mayDelete: true,
        subscriptionId: id,
        subscriptionUrl: subscription.url,
        ...(groupSlug ? { scope: "group" as const, groupSlug } : { scope: "personal" as const }),
      };
      return created;
    },
    getCalendarSubscription: async (subscriptionId) => {
      const subscription = state.subscriptions.get(subscriptionId);
      if (!subscription) throw new Error("Subscription not found");
      return subscription;
    },
    unsubscribeCalendar: async (subscriptionId) => {
      state.subscriptions.delete(subscriptionId);
    },
    refreshStaleCalendarSubscriptions: async () => false,
    getCalendarFeed: async (calendarId) => state.feeds.get(calendarId) ?? null,
    publishCalendarFeed: async (calendarId) => {
      const feed: CalendarFeedInfo = {
        httpsUrl: `https://example.test/api/v1/calendars/feeds/${calendarId}token`,
        webcalUrl: `webcal://example.test/api/v1/calendars/feeds/${calendarId}token`,
      };
      state.feeds.set(calendarId, feed);
      return feed;
    },
    unpublishCalendarFeed: async (calendarId) => {
      state.feeds.delete(calendarId);
    },
  };
}
