import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarInfo } from "@/calendar-core/src/calendar-types";

export const ICS_FILE_ACCEPT = ".ics,text/calendar";

export const NEW_CALENDAR_IMPORT_VALUE = "__new_calendar__";

export function isIcsFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".ics") || name.endsWith(".ical") || file.type === "text/calendar";
}

/** Default calendar name from an ICS filename. Empty when nothing sensible remains. */
export function inferCalendarNameFromIcsFileName(fileName: string): string {
  const leaf = fileName.trim().split(/[/\\]/).pop() ?? "";
  return leaf.replace(/\.(ics|ical)$/i, "").trim();
}

export function icsFileFromList(fileList: FileList | null): File | null {
  return filterIcsFiles(fileList)[0] ?? null;
}

export function filterIcsFiles(fileList: FileList | null): File[] {
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList).filter(isIcsFile);
}

export async function readIcsFile(file: File): Promise<string> {
  return file.text();
}

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
