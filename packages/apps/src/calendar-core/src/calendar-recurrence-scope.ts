import { Temporal } from "@js-temporal/polyfill";
import { parseRecurrenceId } from "@/lib/calendar-engine";
import type {
  JmapCalendarEvent,
  JSCalendarPatchObject,
  JSCalendarRecurrenceRule,
} from "@/lib/jmap-client";
import type { CalendarEventDraft } from "@/calendar-core/src/calendar-types";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import { formRecurrenceRules, formToDraft } from "@/calendar-core/src/calendar-editor-model";

/** User choice for editing/moving/resizing a recurring occurrence. */
export type RecurrenceEditScope = "thisInstance" | "thisAndFuture";

/**
 * Delete adds `allInstances` so the whole series can be destroyed (not just
 * excluded or truncated). Edit/move/resize never offer this option.
 */
export type RecurrenceDeleteScope = RecurrenceEditScope | "allInstances";

/** Resolved choice from the scope dialog (edit or delete). */
export type RecurrenceScopeChoice = RecurrenceDeleteScope;

export type RecurrenceScopeAction = "edit" | "delete" | "update";

export type RecurrenceScopeRequest = {
  action: RecurrenceScopeAction;
  masterId: string;
  recurrenceId?: string;
  /** Optional short context shown under the title (e.g. move target time). */
  description?: string;
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
 * Normalize engine compact ids (`20260311T090000`) or LocalDateTime strings to
 * JSCalendar `recurrenceOverrides` keys.
 */
export function toLocalRecurrenceId(
  recurrenceId: string,
  allDay: boolean,
  templateStart?: string,
): string {
  if (recurrenceId.includes("-")) return recurrenceId;
  const template = Temporal.PlainDateTime.from(
    templateStart?.includes("T")
      ? templateStart.replace(/Z$/, "")
      : templateStart
        ? `${templateStart}T00:00:00`
        : "1970-01-01T00:00:00",
  );
  const parsed = parseRecurrenceId(recurrenceId, allDay, template);
  if (!parsed) return recurrenceId;
  return allDay ? parsed.toPlainDate().toString() : parsed.toString({ smallestUnit: "second" });
}

/**
 * Instant strictly before the occurrence so the master series keeps past
 * instances and excludes this occurrence and later ones (`until` is inclusive
 * in JSCalendar — subtract one day for all-day, one second for timed).
 */
export function untilBeforeRecurrenceId(
  recurrenceId: string,
  allDay: boolean,
  templateStart?: string,
): string {
  const local = toLocalRecurrenceId(recurrenceId, allDay, templateStart);
  const normalized = local.includes("T") ? local : `${local}T00:00:00`;
  try {
    const instant = Temporal.PlainDateTime.from(normalized.replace(/Z$/, ""));
    if (allDay) {
      return instant.toPlainDate().subtract({ days: 1 }).toString();
    }
    return instant.subtract({ seconds: 1 }).toString();
  } catch {
    return local;
  }
}

export function truncateRecurrenceRules(
  rules: JSCalendarRecurrenceRule[] | null | undefined,
  until: string,
): JSCalendarRecurrenceRule[] {
  const base = rules?.[0];
  if (!base) {
    // Prefer callers passing real series rules. Inventing `daily` used to wipe
    // weekly/custom series when bootstrap `data.events` lagged the adapter.
    return [{ "@type": "RecurrenceRule", frequency: "daily", until }];
  }
  const { count: _count, ...rest } = base;
  return [{ ...rest, until }];
}

/**
 * Rules for truncate/fork. Prefer the wire master; fall back to the editor form
 * when bootstrap `data.events` is stale (common right after create — the adapter
 * shows the series but React bootstrap has not refreshed yet).
 */
export function seriesRecurrenceRulesForSplit(
  original: Pick<JmapCalendarEvent, "recurrenceRules"> | undefined,
  form: CalendarEventFormValue,
): JSCalendarRecurrenceRule[] | null {
  if (original?.recurrenceRules?.length) return original.recurrenceRules;
  return formRecurrenceRules(form);
}

/**
 * Shift form wall times to the edited occurrence while keeping duration.
 *
 * Surface `events` maps only hold masters (views expand), so opening an
 * occurrence key without an engine row would otherwise leave the master's
 * series start — and a this-and-future fork would overlap past instances.
 */
export function formAnchoredToOccurrence(
  form: CalendarEventFormValue,
  recurrenceId: string,
): CalendarEventFormValue {
  const templateStart = form.allDay
    ? `${form.startDate}T00:00:00`
    : `${form.startDate}T${form.startTime || "00:00"}:00`;
  const local = toLocalRecurrenceId(recurrenceId, form.allDay, templateStart);
  let occurrenceStart: Temporal.PlainDateTime;
  try {
    occurrenceStart = Temporal.PlainDateTime.from(
      local.includes("T") ? local.replace(/Z$/, "") : `${local}T00:00:00`,
    );
  } catch {
    return form;
  }

  const currentStart = form.allDay
    ? Temporal.PlainDateTime.from(`${form.startDate}T00:00:00`)
    : Temporal.PlainDateTime.from(`${form.startDate}T${form.startTime || "00:00"}:00`);
  const currentEndExclusive = form.allDay
    ? Temporal.PlainDateTime.from(`${form.endDate}T00:00:00`).add({ days: 1 })
    : Temporal.PlainDateTime.from(`${form.endDate}T${form.endTime || "00:00"}:00`);
  let duration: Temporal.Duration;
  try {
    duration = currentStart.until(currentEndExclusive);
  } catch {
    duration = Temporal.Duration.from(form.allDay ? "P1D" : "PT1H");
  }
  if (duration.total({ unit: "seconds" }) <= 0) {
    duration = Temporal.Duration.from(form.allDay ? "P1D" : "PT1H");
  }
  const occurrenceEndExclusive = occurrenceStart.add(duration);
  const formEnd = form.allDay
    ? occurrenceEndExclusive.subtract({ days: 1 })
    : occurrenceEndExclusive;

  return {
    ...form,
    startDate: occurrenceStart.toPlainDate().toString(),
    startTime: occurrenceStart.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

/** Build the forked series draft starting at the edited occurrence. */
export function forkSeriesDraftFromForm(
  form: CalendarEventFormValue,
  originalRules: JSCalendarRecurrenceRule[] | null | undefined,
): CalendarEventDraft {
  const draft = formToDraft(form);
  if (form.recurrencePreset === "none") {
    return { ...draft, recurrenceRules: null };
  }
  // Wire master first; else form preset/custom (covers stale bootstrap lookups).
  const baseRule =
    originalRules?.[0] ?? formRecurrenceRules(form)?.[0] ?? draft.recurrenceRules?.[0];
  if (!baseRule) {
    return draft;
  }
  const { until: _until, count: _count, ...rest } = baseRule;
  return {
    ...draft,
    recurrenceRules: [rest],
  };
}

/** Merge `{ excluded: true }` for one occurrence into the master's overrides map. */
export function exclusionRecurrenceOverrides(
  original: JmapCalendarEvent | undefined,
  recurrenceId: string,
): Record<string, JSCalendarPatchObject> {
  const allDay = Boolean(original?.showWithoutTime);
  const localRid = toLocalRecurrenceId(recurrenceId, allDay, original?.start);
  const existing = original?.recurrenceOverrides ?? {};
  const previous = existing[localRid] ?? {};
  return {
    ...existing,
    [localRid]: { ...previous, excluded: true },
  };
}

/**
 * Diff the editor form against the master series into a single-occurrence
 * JSCalendar patch, merged into existing `recurrenceOverrides`.
 */
export function occurrenceRecurrenceOverrides(
  form: CalendarEventFormValue,
  original: JmapCalendarEvent,
  recurrenceId: string,
): Record<string, JSCalendarPatchObject> | null {
  const allDay = Boolean(original.showWithoutTime);
  const localRid = toLocalRecurrenceId(recurrenceId, allDay, original.start);
  const draft = formToDraft({ ...form, recurrencePreset: "none" });
  const patch: JSCalendarPatchObject = {};

  if (form.title.trim() !== (original.title ?? "")) patch.title = draft.title;

  const defaultStart = allDay
    ? `${localRid.includes("T") ? localRid.slice(0, 10) : localRid}T00:00:00`
    : localRid;
  if (draft.start !== defaultStart) patch.start = draft.start;

  const originalDuration = original.duration ?? (allDay ? "P1D" : "PT0S");
  if (draft.duration !== originalDuration) patch.duration = draft.duration;

  if (form.allDay !== allDay) patch.showWithoutTime = form.allDay;

  const originalLocation = primaryLocationName(original);
  if (form.location.trim() !== originalLocation) {
    patch.locations = form.location.trim()
      ? { primary: { "@type": "Location", name: form.location.trim() } }
      : null;
  }

  const originalDescription = typeof original.description === "string" ? original.description : "";
  if (form.description.trim() !== originalDescription) {
    patch.description = form.description.trim();
  }

  if (Object.keys(patch).length === 0) return null;

  const existing = original.recurrenceOverrides ?? {};
  const previous = existing[localRid] ?? {};
  return {
    ...existing,
    [localRid]: { ...previous, ...patch },
  };
}

function primaryLocationName(event: JmapCalendarEvent): string {
  const locations = event.locations;
  if (!locations) return "";
  const key = Object.keys(locations).sort()[0];
  return key ? (locations[key]?.name ?? "") : "";
}
