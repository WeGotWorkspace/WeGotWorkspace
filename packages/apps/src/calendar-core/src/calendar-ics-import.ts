import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarInfo } from "@/calendar-core/src/calendar-types";

export {
  ICS_FILE_ACCEPT,
  filterIcsFiles,
  icsFileFromList,
  inferCollectionNameFromIcsFileName as inferCalendarNameFromIcsFileName,
  isIcsFile,
  readIcsFile,
} from "@/lib/ics-import/ics-file";

export type CalendarIcsImportDestination =
  | { mode: "existing"; calendarId: string }
  | { mode: "create"; name: string; color: string; groupSlug?: string | null };

export type CalendarIcsImportResult = {
  list: JmapCalendarEvent[];
  errors: Array<{ index: number; message: string }>;
  calendarId: string;
  createdCalendar?: CalendarInfo;
};

export async function runCalendarIcsImport(
  operations: CalendarAPIOperations,
  icsText: string,
  destination: CalendarIcsImportDestination,
): Promise<CalendarIcsImportResult> {
  if (!operations.importEvents) {
    throw new Error("ICS import is not available");
  }

  let calendarId = destination.mode === "existing" ? destination.calendarId : "";
  let createdCalendar: CalendarInfo | undefined;
  if (destination.mode === "create") {
    if (!operations.createCalendar) {
      throw new Error("Creating a calendar is not available");
    }
    createdCalendar = await operations.createCalendar({
      name: destination.name,
      color: destination.color,
      ...(destination.groupSlug?.trim() ? { groupSlug: destination.groupSlug.trim() } : {}),
    });
    calendarId = createdCalendar.id;
  }

  const result = await operations.importEvents(icsText, { calendarId });
  return {
    list: result.list,
    errors: result.errors,
    calendarId,
    createdCalendar,
  };
}
