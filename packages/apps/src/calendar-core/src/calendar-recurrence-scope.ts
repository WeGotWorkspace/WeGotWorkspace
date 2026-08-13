import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent, JSCalendarRecurrenceRule } from "@/lib/jmap-client";
import type { CalendarEventDraft } from "@/calendar-core/src/calendar-types";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { formToDraft } from "@/calendar-core/src/calendar-editor-model";

/** User choice for editing/deleting a recurring occurrence. */
export type RecurrenceEditScope = "all" | "thisAndFuture";

export type RecurrenceScopeAction = "edit" | "delete" | "update";

export type RecurrenceScopeRequest = {
  action: RecurrenceScopeAction;
  masterId: string;
  recurrenceId?: string;
};

/** Engine keys detached exceptions / expanded occurrences as `${masterId}::${recurrenceId}`. */
export function splitOccurrenceKey(key: string): { masterId: string; recurrenceId?: string } {
  const separator = key.indexOf("::");
  if (separator === -1) return { masterId: key };
  return { masterId: key.slice(0, separator), recurrenceId: key.slice(separator + 2) };
}

export function eventIsRecurringSeries(event: Pick<JmapCalendarEvent, "recurrenceRules">): boolean {
  return Boolean(event.recurrenceRules && event.recurrenceRules.length > 0);
}

/**
 * Instant strictly before the occurrence so the master series keeps past
 * instances and excludes this occurrence and later ones (`until` is inclusive
 * in JSCalendar — subtract one day for all-day, one second for timed).
 */
export function untilBeforeRecurrenceId(recurrenceId: string, allDay: boolean): string {
  const normalized = recurrenceId.includes("T") ? recurrenceId : `${recurrenceId}T00:00:00`;
  try {
    const instant = Temporal.PlainDateTime.from(normalized.replace(/Z$/, ""));
    if (allDay) {
      return instant.toPlainDate().subtract({ days: 1 }).toString();
    }
    return instant.subtract({ seconds: 1 }).toString();
  } catch {
    return recurrenceId;
  }
}

export function truncateRecurrenceRules(
  rules: JSCalendarRecurrenceRule[] | null | undefined,
  until: string,
): JSCalendarRecurrenceRule[] {
  const base = rules?.[0];
  if (!base) {
    return [{ "@type": "RecurrenceRule", frequency: "daily", until }];
  }
  const { count: _count, ...rest } = base;
  return [{ ...rest, until }];
}

/** Build the forked series draft starting at the edited occurrence. */
export function forkSeriesDraftFromForm(
  form: CalendarEventFormValue,
  originalRules: JSCalendarRecurrenceRule[] | null | undefined,
): CalendarEventDraft {
  const draft = formToDraft(form);
  const baseRule = originalRules?.[0];
  if (!baseRule || form.recurrencePreset === "none") {
    return { ...draft, recurrenceRules: null };
  }
  const { until: _until, count: _count, ...rest } = baseRule;
  return {
    ...draft,
    recurrenceRules: [rest],
  };
}
