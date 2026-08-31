export type { JmapEventsAdapterOptions } from "./adapter/JmapEventsAdapter.js";
export { JmapEventsAdapter } from "./adapter/JmapEventsAdapter.js";
export type { JmapNotesAdapterOptions } from "./adapter/JmapNotesAdapter.js";
export { JmapNotesAdapter } from "./adapter/JmapNotesAdapter.js";
export type { JmapContactsAdapterOptions } from "./adapter/JmapContactsAdapter.js";
export { JmapContactsAdapter } from "./adapter/JmapContactsAdapter.js";
export { NOTES_USING, JmapNotesClient } from "./notes/JmapNotesClient.js";
export type { JmapNote, JmapNotebook } from "./notes/types.js";
export type { DateRange } from "./calendars/JmapCalendarsClient.js";
export { JmapCalendarsClient } from "./calendars/JmapCalendarsClient.js";
export { JmapFileNodePathCache } from "./filenodes/JmapFileNodePathCache.js";
export { FILENODE_USING, JmapFileNodesClient } from "./filenodes/JmapFileNodesClient.js";
export type {
  JmapFileNode,
  JmapFileNodeCreate,
  JmapFileNodeFilter,
  JmapFileNodeNote,
  JmapFileNodeNotePatch,
  JmapFileNodeType,
  JmapFilesRights,
} from "./filenodes/types.js";
export type {
  JmapCalendar,
  JmapCalendarEvent,
  JmapCalendarEventFilterCondition,
  JmapCalendarRights,
} from "./calendars/types.js";
export { CONTACTS_USING, JmapContactsClient } from "./contacts/JmapContactsClient.js";
export type {
  JmapAddressBook,
  JmapAddressBookRights,
  JmapContactCard,
  JmapContactCardFilterCondition,
} from "./contacts/types.js";
export { JmapMethodError, JmapRequestError, JmapSetItemError } from "./core/errors.js";
export type { JmapClientOptions, JmapFetch } from "./core/JmapClient.js";
export { JmapClient } from "./core/JmapClient.js";
export {
  CALENDARS_CAPABILITY,
  CONTACTS_CAPABILITY,
  type ChangesResponse,
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  NOTES_CAPABILITY,
  type GetResponse,
  type JmapId,
  type JmapInvocation,
  type JmapRequest,
  type JmapResponse,
  type JmapSession,
  type JmapSetError,
  type JmapState,
  type QueryResponse,
  type SetResponse,
} from "./core/types.js";
export type {
  JSCalendarAlert,
  JSCalendarAlertAction,
  JSCalendarEvent,
  JSCalendarLink,
  JSCalendarLocalDateTime,
  JSCalendarPatchObject,
  JSCalendarRecurrenceRule,
  JSCalendarWeekday,
} from "./jscalendar/types.js";
export { jmapCalendarsToMap, jmapCalendarToInternal } from "./mapping/calendar.js";
export type { InternalEventGroup, InternalEventRow } from "./mapping/event.js";
export {
  collectInternalGroup,
  durationFromJmapEvent,
  internalGroupToJmapEvent,
  jmapEventToInternalRows,
} from "./mapping/event.js";
export { localToPlainDateTime } from "./mapping/datetime.js";
export { internalRecurrenceRuleToJs, jsRecurrenceRuleToInternal } from "./mapping/recurrence.js";
export {
  allDayEvent as mockAllDayEvent,
  personalCalendar as mockPersonalCalendar,
  recurringEvent as mockRecurringEvent,
  timedEvent as mockTimedEvent,
  workCalendar as mockWorkCalendar,
} from "./mock/fixtures.js";
export { MockJmapServer } from "./mock/MockJmapServer.js";
