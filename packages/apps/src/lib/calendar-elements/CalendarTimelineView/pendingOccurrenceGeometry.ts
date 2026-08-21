import { Temporal } from "@js-temporal/polyfill";

/** Suggested start/end for an occurrence while the series-scope dialog is open. */
export type PendingOccurrenceGeometry = {
  key: string;
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
};

export type EngineOccurrenceTimes = {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
};

/**
 * Display times for a rendered occurrence: the live drag suggestion wins until the
 * engine map catches up or the user cancels.
 */
export function occurrenceTimesWithPending(
  key: string,
  engine: EngineOccurrenceTimes,
  pending: PendingOccurrenceGeometry | null,
): EngineOccurrenceTimes {
  if (!pending || pending.key !== key) return engine;
  return { start: pending.start, end: pending.end };
}

/**
 * Drop the overlay once the occurrence is gone (fork replaced it) or the engine
 * already stores the suggested times. Keep it while the map still has the old slot.
 */
export function pendingOccurrenceRetention(
  pending: PendingOccurrenceGeometry,
  engineTimesByKey: ReadonlyMap<string, EngineOccurrenceTimes>,
): "keep" | "clear" {
  const engine = engineTimesByKey.get(pending.key);
  if (!engine) return "clear";
  if (
    Temporal.PlainDateTime.compare(engine.start, pending.start) === 0 &&
    Temporal.PlainDateTime.compare(engine.end, pending.end) === 0
  ) {
    return "clear";
  }
  return "keep";
}

/** Cancel / unhandled: revert. Confirm (including this-and-future) keeps the preview. */
export function shouldRevertPendingGeometry(result: {
  handled: boolean;
  accepted: boolean;
}): boolean {
  return !result.handled || !result.accepted;
}

/** Suggested slot for a drag-create while the create dialog is open or save is in flight. */
export type PendingCreateGeometry = {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  allDay: boolean;
  title?: string;
};

export type EngineCreateCandidate = EngineOccurrenceTimes & {
  allDay?: boolean;
};

/**
 * Drop the create-preview card once a real event occupies the same slot.
 * Keep it while the map has no matching event (dialog still open / save in flight).
 */
export function pendingCreateRetention(
  pending: PendingCreateGeometry,
  engineEvents: Iterable<EngineCreateCandidate>,
): "keep" | "clear" {
  for (const event of engineEvents) {
    if (event.allDay !== undefined && event.allDay !== pending.allDay) continue;
    if (
      Temporal.PlainDateTime.compare(event.start, pending.start) === 0 &&
      Temporal.PlainDateTime.compare(event.end, pending.end) === 0
    ) {
      return "clear";
    }
  }
  return "keep";
}
