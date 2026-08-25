import { Temporal } from "@js-temporal/polyfill";
import {
  expandRecurringStarts,
  parseRecurrenceId,
  splitOccurrenceKey,
  type CalendarEvent as EngineCalendarEvent,
  type CalendarEventsMap,
} from "@/lib/calendar-engine";
import {
  collectInternalGroup,
  internalGroupToJmapEvent,
  jsRecurrenceRuleToInternal,
  type JmapCalendarEvent,
  type JSCalendarPatchObject,
  type JSCalendarRecurrenceRule,
} from "@/lib/jmap-client";
import type { CalendarEventDraft, CalendarEventPatch } from "@/calendar-core/src/calendar-types";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import {
  alertMapsEqual,
  alertsToWire,
  freeBusyStatusFromWire,
} from "@/calendar-core/src/calendar-alerts";
import { formRecurrenceRules, formToDraft } from "@/calendar-core/src/calendar-editor-model";

export { splitOccurrenceKey };

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

/**
 * Resolve a recurring series master whether `masterId` is the engine/JMAP map
 * key or the JSCalendar `uid` (Lit update envelopes historically used `eventId` = uid).
 */
export function resolveRecurrenceMasterRef(
  masterId: string,
  wireEvents: readonly JmapCalendarEvent[],
  surfaceEvents?: CalendarEventsMap,
): {
  masterKey: string;
  original: JmapCalendarEvent | undefined;
  masterEngine: EngineCalendarEvent | undefined;
} {
  const byId = wireEvents.find((entry) => entry.id === masterId);
  const byUid = byId ? undefined : wireEvents.find((entry) => entry.uid === masterId);
  let original = byId ?? byUid;
  let masterKey = byId ? masterId : (original?.id ?? masterId);
  let masterEngine = surfaceEvents?.get(masterKey) ?? surfaceEvents?.get(masterId);

  if (!masterEngine && surfaceEvents) {
    for (const [key, event] of surfaceEvents) {
      if (splitOccurrenceKey(key).recurrenceId) continue;
      if (event.eventId === masterId) {
        masterEngine = event;
        masterKey = key;
        break;
      }
    }
  }

  if (!original && masterKey !== masterId) {
    original = wireEvents.find((entry) => entry.id === masterKey);
  }

  return { masterKey, original, masterEngine };
}

export function eventIsRecurringSeries(event: Pick<JmapCalendarEvent, "recurrenceRules">): boolean {
  return Boolean(event.recurrenceRules && event.recurrenceRules.length > 0);
}

function overridePatchForOccurrence(
  original: Pick<JmapCalendarEvent, "recurrenceOverrides" | "showWithoutTime" | "start">,
  recurrenceId: string,
): JSCalendarPatchObject | undefined {
  const allDay = Boolean(original.showWithoutTime);
  const local = toLocalRecurrenceId(recurrenceId, allDay, original.start);
  const overrides = original.recurrenceOverrides;
  if (!overrides) return undefined;
  const patch = overrides[local] ?? overrides[recurrenceId];
  return patch && typeof patch === "object" ? patch : undefined;
}

/**
 * True when this occurrence is already a detached this-instance exception
 * (a non-exclusion recurrenceOverrides patch). Later edits skip the scope dialog.
 */
export function occurrenceHasThisInstanceOverride(
  original:
    | Pick<JmapCalendarEvent, "recurrenceOverrides" | "showWithoutTime" | "start">
    | undefined,
  recurrenceId: string,
): boolean {
  if (!original) return false;
  const patch = overridePatchForOccurrence(original, recurrenceId);
  if (!patch) return false;
  return patch.excluded !== true;
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
    let instant = Temporal.PlainDateTime.from(normalized.replace(/Z$/, ""));
    // A moved wall clock (second drag / this-and-future destination) is not a
    // series slot. Truncate before the original DTSTART time on that date so
    // the master does not keep emitting the cut occurrence (or the next day).
    if (!allDay && templateStart) {
      const template = recurrenceIdAsPlainDateTime(templateStart, false, templateStart);
      if (
        template &&
        (instant.hour !== template.hour ||
          instant.minute !== template.minute ||
          instant.second !== template.second)
      ) {
        instant = instant.with({
          hour: template.hour,
          minute: template.minute,
          second: template.second,
        });
      }
    }
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

/** Parse a recurrence id (compact or LocalDateTime) to PlainDateTime for ordering. */
export function recurrenceIdAsPlainDateTime(
  recurrenceId: string,
  allDay: boolean,
  templateStart?: string,
): Temporal.PlainDateTime | null {
  const local = toLocalRecurrenceId(recurrenceId, allDay, templateStart);
  try {
    return Temporal.PlainDateTime.from(
      local.includes("T") ? local.replace(/Z$/, "") : `${local}T00:00:00`,
    );
  } catch {
    return null;
  }
}

function formatLocalRecurrenceKey(value: Temporal.PlainDateTime, allDay: boolean): string {
  return allDay ? value.toPlainDate().toString() : value.toString({ smallestUnit: "second" });
}

/**
 * Partition `recurrenceOverrides` for a this-and-future split at occurrence T.
 * Master keeps overrides strictly before T; fork receives T and later (≥ T).
 */
export function splitRecurrenceOverridesAt(
  overrides: Record<string, JSCalendarPatchObject> | null | undefined,
  splitRecurrenceId: string,
  allDay: boolean,
  templateStart?: string,
): {
  masterOverrides: Record<string, JSCalendarPatchObject> | null;
  forkOverrides: Record<string, JSCalendarPatchObject> | null;
} {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { masterOverrides: null, forkOverrides: null };
  }
  const splitAt = recurrenceIdAsPlainDateTime(splitRecurrenceId, allDay, templateStart);
  const master: Record<string, JSCalendarPatchObject> = {};
  const fork: Record<string, JSCalendarPatchObject> = {};
  for (const [rid, patch] of Object.entries(overrides)) {
    const instant = recurrenceIdAsPlainDateTime(rid, allDay, templateStart);
    if (!splitAt || !instant) {
      // Unparseable keys stay on the truncated master to avoid silent data loss.
      master[rid] = patch;
      continue;
    }
    if (Temporal.PlainDateTime.compare(instant, splitAt) < 0) {
      master[rid] = patch;
    } else {
      fork[rid] = patch;
    }
  }
  return {
    masterOverrides: Object.keys(master).length ? master : null,
    forkOverrides: Object.keys(fork).length ? fork : null,
  };
}

/**
 * Remap override keys (and nested `start` patches) when the fork DTSTART moves
 * away from the original occurrence wall time (drag / reschedule this-and-future).
 */
export function shiftRecurrenceOverrides(
  overrides: Record<string, JSCalendarPatchObject> | null | undefined,
  fromOccurrenceId: string,
  toForkStartLocal: string,
  allDay: boolean,
  templateStart?: string,
): Record<string, JSCalendarPatchObject> | null {
  if (!overrides || Object.keys(overrides).length === 0) return null;
  const from = recurrenceIdAsPlainDateTime(fromOccurrenceId, allDay, templateStart);
  const to = recurrenceIdAsPlainDateTime(toForkStartLocal, allDay, templateStart);
  if (!from || !to) return { ...overrides };
  const shift = from.until(to);
  if (shift.total({ unit: "seconds" }) === 0) return { ...overrides };

  const out: Record<string, JSCalendarPatchObject> = {};
  for (const [rid, patch] of Object.entries(overrides)) {
    const instant = recurrenceIdAsPlainDateTime(rid, allDay, templateStart);
    if (!instant) {
      out[rid] = patch;
      continue;
    }
    const newKey = formatLocalRecurrenceKey(instant.add(shift), allDay);
    const nextPatch: JSCalendarPatchObject = { ...patch };
    if (typeof nextPatch.start === "string") {
      const patchStart = recurrenceIdAsPlainDateTime(
        String(nextPatch.start),
        allDay,
        templateStart,
      );
      if (patchStart) {
        nextPatch.start = formatLocalRecurrenceKey(patchStart.add(shift), allDay);
      }
    }
    out[newKey] = nextPatch;
  }
  return out;
}

/**
 * Rebuild `recurrenceOverrides` from adapter/engine rows (master + detached
 * exceptions / exclusionDates). Used when React bootstrap `data.events` lags
 * the surface after an only-this edit — partitioning from stale wire would leave
 * the exception on the master and expand a twin on the fork.
 */
export function recurrenceOverridesFromEngineMap(
  events: CalendarEventsMap,
  masterKey: string,
  original?: Partial<Pick<JmapCalendarEvent, "recurrenceOverrides" | "uid" | "calendarIds">>,
): Record<string, JSCalendarPatchObject> | null {
  const group = collectInternalGroup(events, masterKey);
  if (!group) return null;
  const wire = internalGroupToJmapEvent(group, {
    original: original as JmapCalendarEvent | undefined,
  });
  const overrides = wire.recurrenceOverrides;
  if (!overrides || typeof overrides !== "object") return null;
  const entries = Object.entries(overrides).filter(
    (entry): entry is [string, JSCalendarPatchObject] =>
      entry[1] != null && typeof entry[1] === "object",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Prefer adapter/surface overrides (fresher after only-this) over bootstrap wire.
 */
export function resolveSeriesRecurrenceOverrides(
  original: Pick<JmapCalendarEvent, "recurrenceOverrides"> | undefined,
  masterKey: string,
  surfaceEvents?: CalendarEventsMap,
): Record<string, JSCalendarPatchObject> | null {
  if (surfaceEvents) {
    const fromSurface = recurrenceOverridesFromEngineMap(surfaceEvents, masterKey, original);
    if (fromSurface && Object.keys(fromSurface).length) return fromSurface;
  }
  const wire = original?.recurrenceOverrides;
  return wire && Object.keys(wire).length ? wire : null;
}

/**
 * Truncate-master patch for this-and-future (edit fork, delete, or Lit truncate):
 * set `until` and keep only overrides that apply before the split occurrence.
 *
 * Keys that move to the fork are explicitly set to `null` so servers that
 * deep-merge override maps still drop them (omission alone is not enough).
 */
export function truncateMasterSeriesPatch(
  seriesRules: JSCalendarRecurrenceRule[] | null | undefined,
  recurrenceId: string,
  allDay: boolean,
  templateStart: string | undefined,
  originalOverrides: Record<string, JSCalendarPatchObject> | null | undefined,
): CalendarEventPatch {
  const until = untilBeforeRecurrenceId(recurrenceId, allDay, templateStart);
  const { masterOverrides } = splitRecurrenceOverridesAt(
    originalOverrides,
    recurrenceId,
    allDay,
    templateStart,
  );
  const hadOverrides = Boolean(originalOverrides && Object.keys(originalOverrides).length);
  if (!hadOverrides) {
    return { recurrenceRules: truncateRecurrenceRules(seriesRules, until) };
  }
  if (!masterOverrides) {
    return {
      recurrenceRules: truncateRecurrenceRules(seriesRules, until),
      recurrenceOverrides: null,
    };
  }
  const cleared: Record<string, JSCalendarPatchObject | null> = { ...masterOverrides };
  for (const rid of Object.keys(originalOverrides ?? {})) {
    if (!(rid in masterOverrides)) cleared[rid] = null;
  }
  return {
    recurrenceRules: truncateRecurrenceRules(seriesRules, until),
    recurrenceOverrides: cleared,
  };
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

export type ForkSeriesDraftOptions = {
  /**
   * Overrides that belong on the fork (≥ split occurrence). Remapped when
   * `splitRecurrenceId` differs from the fork's new DTSTART.
   */
  recurrenceOverrides?: Record<string, JSCalendarPatchObject> | null;
  /** Original occurrence id before any wall-time shift (drag / reschedule). */
  splitRecurrenceId?: string;
  /** Series master start — template for compact recurrence ids. */
  templateStart?: string;
};

/** Build the forked series draft starting at the edited occurrence. */
export function forkSeriesDraftFromForm(
  form: CalendarEventFormValue,
  originalRules: JSCalendarRecurrenceRule[] | null | undefined,
  options?: ForkSeriesDraftOptions,
): CalendarEventDraft {
  const draft = formToDraft(form);
  const shiftedOverrides =
    options?.recurrenceOverrides && options.splitRecurrenceId
      ? shiftRecurrenceOverrides(
          options.recurrenceOverrides,
          options.splitRecurrenceId,
          draft.start,
          form.allDay,
          options.templateStart,
        )
      : (options?.recurrenceOverrides ?? null);
  const withOverrides = (base: CalendarEventDraft): CalendarEventDraft =>
    shiftedOverrides && Object.keys(shiftedOverrides).length
      ? { ...base, recurrenceOverrides: shiftedOverrides }
      : base;

  if (form.recurrencePreset === "none") {
    return withOverrides({ ...draft, recurrenceRules: null });
  }
  // Wire master first; else form preset/custom (covers stale bootstrap lookups).
  const baseRule =
    originalRules?.[0] ?? formRecurrenceRules(form)?.[0] ?? draft.recurrenceRules?.[0];
  if (!baseRule) {
    return withOverrides(draft);
  }
  return withOverrides({
    ...draft,
    recurrenceRules: [forkRecurrenceRule(baseRule, draft.start, form.allDay, options)],
  });
}

/**
 * Occurrences still owed on the fork, including the split instance. `count`
 * counted from the previous DTSTART — keeping it verbatim would add extra
 * days after the cut; dropping it makes a finite series infinite.
 */
function remainingForkCount(
  baseRule: JSCalendarRecurrenceRule,
  forkStart: string,
  allDay: boolean,
  options?: ForkSeriesDraftOptions,
): number | undefined {
  if (baseRule.count === undefined) return undefined;
  const templateStart = options?.templateStart ?? forkStart;
  const splitId = options?.splitRecurrenceId ?? forkStart;
  const seriesStart = recurrenceIdAsPlainDateTime(templateStart, allDay, templateStart);
  const splitAt = recurrenceIdAsPlainDateTime(splitId, allDay, templateStart);
  if (!seriesStart || !splitAt) return Math.max(1, baseRule.count);
  const { count: _count, until: _until, ...ruleRest } = baseRule;
  const internal = jsRecurrenceRuleToInternal(ruleRest);
  if (!internal) return Math.max(1, baseRule.count);
  const used = expandRecurringStarts(
    {
      data: {
        start: seriesStart,
        duration: Temporal.Duration.from(allDay ? "P1D" : "PT1H"),
        recurrenceRule: internal,
      },
    } as EngineCalendarEvent,
    seriesStart,
    splitAt,
  ).filter((start) => Temporal.PlainDateTime.compare(start, splitAt) < 0).length;
  return Math.max(1, baseRule.count - used);
}

/**
 * Continue the object being split (RFC 8984 this-and-future). Keep `until` when
 * it still ends after the fork DTSTART so a later sibling series is not
 * overlapped. Shift that until by the same wall-clock delta as DTSTART (a 10:00
 * cutoff must stay a cutoff after the series moves to 09:00). Replace `count`
 * with the remaining occurrences (including the split).
 */
function forkRecurrenceRule(
  baseRule: JSCalendarRecurrenceRule,
  forkStart: string,
  allDay: boolean,
  options?: ForkSeriesDraftOptions,
): JSCalendarRecurrenceRule {
  const remaining = remainingForkCount(baseRule, forkStart, allDay, options);
  const withRemainingCount = (rule: JSCalendarRecurrenceRule): JSCalendarRecurrenceRule =>
    remaining !== undefined ? { ...rule, count: remaining } : rule;
  const { count: _count, until, ...rest } = baseRule;
  if (!until) return withRemainingCount(rest);
  const templateStart = options?.templateStart ?? forkStart;
  let nextUntil = until;
  if (options?.splitRecurrenceId) {
    const from = recurrenceIdAsPlainDateTime(options.splitRecurrenceId, allDay, templateStart);
    const to = recurrenceIdAsPlainDateTime(forkStart, allDay, templateStart);
    const untilAt = recurrenceIdAsPlainDateTime(until, allDay, templateStart);
    if (from && to && untilAt) {
      nextUntil = formatLocalRecurrenceKey(untilAt.add(from.until(to)), allDay);
    }
  }
  const untilAt = recurrenceIdAsPlainDateTime(nextUntil, allDay, forkStart);
  const startAt = recurrenceIdAsPlainDateTime(forkStart, allDay, forkStart);
  if (untilAt && startAt && Temporal.PlainDateTime.compare(untilAt, startAt) < 0) {
    return withRemainingCount(rest);
  }
  return withRemainingCount({ ...rest, until: nextUntil });
}

/**
 * Fork draft for this-and-future: carry future-side overrides from the master,
 * remapped when the fork DTSTART moves.
 *
 * `overrides` may be supplied explicitly (e.g. resolved from the adapter when
 * bootstrap wire is stale); otherwise `original.recurrenceOverrides` is used.
 */
export function forkSeriesDraftWithSplitOverrides(
  form: CalendarEventFormValue,
  seriesRules: JSCalendarRecurrenceRule[] | null | undefined,
  original:
    | Pick<JmapCalendarEvent, "start" | "showWithoutTime" | "recurrenceOverrides">
    | undefined,
  splitRecurrenceId: string,
  overrides?: Record<string, JSCalendarPatchObject> | null,
): CalendarEventDraft {
  const allDay = Boolean(original?.showWithoutTime ?? form.allDay);
  const sourceOverrides = overrides !== undefined ? overrides : original?.recurrenceOverrides;
  const { forkOverrides } = splitRecurrenceOverridesAt(
    sourceOverrides,
    splitRecurrenceId,
    allDay,
    original?.start,
  );
  return forkSeriesDraftFromForm(form, seriesRules, {
    recurrenceOverrides: forkOverrides,
    splitRecurrenceId,
    templateStart: original?.start,
  });
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

  if (form.freeBusyStatus !== freeBusyStatusFromWire(original.freeBusyStatus)) {
    patch.freeBusyStatus = form.freeBusyStatus;
  }

  const nextAlerts = alertsToWire(form.alerts);
  if (!alertMapsEqual(nextAlerts, original.alerts)) {
    patch.alerts = nextAlerts;
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
