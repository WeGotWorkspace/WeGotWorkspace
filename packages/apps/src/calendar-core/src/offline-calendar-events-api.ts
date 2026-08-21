import {
  EventsAPI,
  type ApplyResult,
  type CalendarEventsMap,
  type CalendarsMap,
  type EventOperation,
} from "@/lib/calendar-engine";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";
import {
  engineEventToForm,
  formToDraft,
  formToFullPatch,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarAPIOperations, CalendarInfo } from "@/calendar-core/src/calendar-types";

const OFFLINE_ACCOUNT_ID = "offline";

export function calendarInfosToEngineMap(calendars: readonly CalendarInfo[]): CalendarsMap {
  const map: CalendarsMap = new Map();
  for (const calendar of calendars) {
    map.set(calendar.id, {
      accountId: OFFLINE_ACCOUNT_ID,
      url: `/calendars/${calendar.id}`,
      displayName: calendar.name,
      color: calendar.color,
      isVisible: calendar.isVisible !== false,
      isDefault: calendar.isDefault === true,
      ...(typeof calendar.sortOrder === "number" ? { sortOrder: calendar.sortOrder } : {}),
    });
  }
  return map;
}

function masterId(key: string, eventId?: string): string {
  if (eventId) return eventId;
  return key.includes("::") ? key.slice(0, key.indexOf("::")) : key;
}

export async function persistOfflineEventChanges(
  operations: CalendarAPIOperations,
  result: ApplyResult,
): Promise<void> {
  for (const change of result.changes) {
    if (change.type === "created") {
      const draft = formToDraft(engineEventToForm(change.event));
      if (!draft.calendarId) continue;
      await operations.createEvent(draft);
      continue;
    }
    if (change.type === "updated") {
      const eventId = masterId(change.key, change.after.eventId);
      if (change.after.pendingOp === "deleted") {
        await operations.deleteEvent(eventId);
        continue;
      }
      await operations.patchEvent(eventId, formToFullPatch(engineEventToForm(change.after)));
      continue;
    }
    await operations.deleteEvent(masterId(change.key, change.before.eventId));
  }
}

export type CreateOfflineCalendarEventsApiArgs = {
  getEvents: () => CalendarEventsMap;
  calendars: readonly CalendarInfo[];
  operations: CalendarAPIOperations;
  selectedCalendarId?: string;
  visibleCalendarIds?: string[];
  onEventsChanged?: (events: CalendarEventsMap) => void;
  onPersisted?: () => void;
};

/** Offline EventsAPI context: local engine apply + hybrid outbox persist. */
export function createOfflineCalendarEventsApi(
  args: CreateOfflineCalendarEventsApiArgs,
): EventsAPIContextValue {
  let overlay: CalendarEventsMap | undefined;
  const calendars = calendarInfosToEngineMap(args.calendars);

  const currentEvents = () => overlay ?? args.getEvents();

  const apply = (operation: EventOperation): ApplyResult => {
    const api = new EventsAPI(currentEvents(), { trackPending: true });
    const result = api.apply(operation);
    overlay = result.nextState;
    args.onEventsChanged?.(overlay);
    void persistOfflineEventChanges(args.operations, result)
      .then(() => args.onPersisted?.())
      .catch(() => undefined);
    return result;
  };

  return {
    getEvents: () => currentEvents(),
    getCalendars: () => calendars,
    getCalendarAccounts: () => new Set([OFFLINE_ACCOUNT_ID]),
    getVisibleCalendarIds: () => args.visibleCalendarIds,
    getSelectedCalendarId: () => {
      if (args.selectedCalendarId) return args.selectedCalendarId;
      for (const calendar of args.calendars) {
        if (calendar.isDefault) return calendar.id;
      }
      return args.calendars[0]?.id;
    },
    apply,
    getApi: () => new EventsAPI(currentEvents(), { trackPending: true }),
    create: (input) => apply({ type: "create", input }),
    update: (input) => apply({ type: "update", input }),
    move: (input) => apply({ type: "move", input }),
    resizeStart: (input) => apply({ type: "resize-start", input }),
    resizeEnd: (input) => apply({ type: "resize-end", input }),
    remove: (input) => apply({ type: "remove", input }),
    addExclusion: (input) => apply({ type: "add-exclusion", input }),
    removeExclusion: (input) => apply({ type: "remove-exclusion", input }),
    addException: (input) => apply({ type: "add-exception", input }),
    removeException: (input) => apply({ type: "remove-exception", input }),
  };
}
