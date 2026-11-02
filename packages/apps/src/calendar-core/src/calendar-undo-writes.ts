import { createElement } from "react";
import { Check } from "lucide-react";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CompletedWriteKeys, ReversibleWriteArgs } from "@/hooks/use-queued-mutation";
import type {
  CalendarAPIOperations,
  CalendarEventDraft,
  CalendarEventPatch,
} from "@/calendar-core/src/calendar-types";
import { calendarEventToForm, formToFullPatch } from "@/calendar-core/src/calendar-editor-model";

type EventWrites = Pick<CalendarAPIOperations, "createEvent" | "patchEvent" | "deleteEvent">;

/** An event write the editor or a drag sends at once; Undo sends `revert` (#1854). */
export type CalendarEventMutation = {
  key: string;
  successToast: string;
  /** Sends the write. A write in several steps marks each step the server applied. */
  mutation: (markCompleted: (step: string) => void) => Promise<void>;
  /** Compensating write for the steps the server applied (`null`: all of them). */
  revert: (completed: CompletedWriteKeys) => Promise<void>;
  /** Puts the screen back, on Undo and on failure. */
  rollback?: () => void;
};

/** Builds the reversible queued write for an event mutation; `onMutated` refreshes after each side. */
export function calendarEventWrite(
  args: CalendarEventMutation,
  options: { onMutated?: () => void; undoToastMessage: string },
): ReversibleWriteArgs {
  return {
    key: args.key,
    toastMessage: args.successToast,
    icon: createElement(Check, { className: "size-4" }),
    execute: async (_signal, markCompleted) => {
      await args.mutation(markCompleted);
      options.onMutated?.();
    },
    revert: async (completed) => {
      await args.revert(completed);
      options.onMutated?.();
    },
    undo: () => args.rollback?.(),
    undoToastMessage: options.undoToastMessage,
  };
}

/** True when the server applied `step` (or the whole write). */
export function stepApplied(completed: CompletedWriteKeys, step: string): boolean {
  return completed === null || completed.has(step);
}

/** Values that clear a field the full patch leaves out when the original had none. */
const CLEARED_FIELDS: Partial<Record<keyof CalendarEventPatch, unknown>> = {
  location: "",
  description: "",
  attendees: [],
};

/**
 * Patches back only the fields `patch` changed, to their value on `original`. A field the
 * original did not have is cleared. The organizer stays: the edit only set it to the person
 * editing, alongside the attendees.
 */
export function editPatchRevert(
  patch: CalendarEventPatch,
  original: JmapCalendarEvent,
): CalendarEventPatch {
  const before = formToFullPatch(calendarEventToForm(original)) as Record<string, unknown>;
  const revert: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof CalendarEventPatch)[]) {
    if (key === "organizer" || key === "calendarId") continue;
    revert[key] = key in before ? before[key] : (CLEARED_FIELDS[key] ?? null);
  }
  return revert as CalendarEventPatch;
}

/**
 * Puts a recurring event's overrides back as they were before an only-this-instance edit.
 * The edited instance gets an explicit `null` when it had no override, so a server that
 * merges override maps drops it too.
 */
export function occurrenceOverridesRevert(
  original: JmapCalendarEvent,
  overrides: Record<string, unknown>,
): CalendarEventPatch {
  const before = original.recurrenceOverrides ?? {};
  const revert: NonNullable<CalendarEventPatch["recurrenceOverrides"]> = { ...before };
  for (const rid of Object.keys(overrides)) {
    if (!(rid in before)) revert[rid] = null;
  }
  return { recurrenceOverrides: revert };
}

/** Steps of a this-and-future split: truncate the master, then create the fork. */
export const SPLIT_STEPS = { truncate: "truncate", fork: "fork" } as const;

/**
 * Undoes a this-and-future split: deletes the fork, then gives the master back the rules
 * (and overrides) the truncate patch changed.
 */
export async function revertSeriesSplit(
  operations: EventWrites,
  completed: CompletedWriteKeys,
  split: {
    masterId: string;
    forkedId: string | undefined;
    truncatePatch: CalendarEventPatch;
    seriesRules: CalendarEventPatch["recurrenceRules"];
    seriesOverrides: CalendarEventPatch["recurrenceOverrides"];
  },
): Promise<void> {
  if (split.forkedId && stepApplied(completed, SPLIT_STEPS.fork)) {
    await operations.deleteEvent(split.forkedId);
  }
  if (!stepApplied(completed, SPLIT_STEPS.truncate)) return;
  const restore: CalendarEventPatch = {
    recurrenceRules: split.seriesRules?.length ? split.seriesRules : null,
  };
  if ("recurrenceOverrides" in split.truncatePatch) {
    // The truncate only drops or keeps instances of the original map: put it back whole.
    restore.recurrenceOverrides = split.seriesOverrides ?? null;
  }
  await operations.patchEvent(split.masterId, restore);
}

/** Steps of a move to another calendar: create the copy, then delete the original. */
export const MOVE_STEPS = { create: "create", delete: "delete" } as const;

/**
 * Undoes a move between calendars. The copy is deleted; the original comes back as a new
 * event only when its delete went through (it gets a new id).
 */
export async function revertEventMove(
  operations: EventWrites,
  completed: CompletedWriteKeys,
  move: { movedToId: string | undefined; originalDraft: CalendarEventDraft | undefined },
): Promise<void> {
  if (move.movedToId && stepApplied(completed, MOVE_STEPS.create)) {
    await operations.deleteEvent(move.movedToId);
  }
  if (move.originalDraft && stepApplied(completed, MOVE_STEPS.delete)) {
    await operations.createEvent(move.originalDraft);
  }
}
