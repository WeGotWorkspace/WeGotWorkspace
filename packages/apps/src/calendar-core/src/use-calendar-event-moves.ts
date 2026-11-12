import { useCallback } from "react";
import type { QueueMutation } from "@/hooks/use-queued-mutation";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/lib/models/calendar-types";
import { calendarEventToForm, draftFromForm } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarEditorState } from "@/calendar-core/src/use-calendar-controller";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarEventWrite,
  MOVE_STEPS,
  revertEventMove,
} from "@/calendar-core/src/calendar-undo-writes";
import { groupOccurrenceKeys } from "@/calendar-core/src/use-calendar-event-deletes";

type UseCalendarEventMovesArgs = {
  L: CalendarUILabels;
  operations?: CalendarAPIOperations;
  events: readonly JmapCalendarEvent[];
  organizer?: { email: string; name?: string };
  queueMutation: QueueMutation;
  ensureCalendarVisible: (calendarId: string) => void;
  onMutated?: () => void;
};

/**
 * Multi-select Move to calendar: each selected event (a repeating one as its whole
 * series) is recreated in the target calendar and its original deleted, as a single
 * move does. One write; Undo moves them back. The event open in the editor moves as its
 * form stands (edits not saved yet included), unless it is one date of a series.
 */
export function useCalendarEventMoves({
  L,
  operations,
  events,
  organizer,
  queueMutation,
  ensureCalendarVisible,
  onMutated,
}: UseCalendarEventMovesArgs) {
  return useCallback(
    (keys: readonly string[], calendarId: string, open?: CalendarEditorState | null) => {
      if (!operations) return;
      const moves = groupOccurrenceKeys(keys, events).flatMap(({ eventId, original }) => {
        if (!original || original.calendarIds?.[calendarId] === true) return [];
        const edited =
          open?.mode === "edit" && open.eventId === eventId && !open.recurrenceId
            ? open.form
            : undefined;
        const form = edited ?? calendarEventToForm(original);
        return [
          {
            eventId,
            draft: draftFromForm({ ...form, calendarId }, organizer),
            originalDraft: draftFromForm(form, organizer),
            movedToId: undefined as string | undefined,
          },
        ];
      });
      if (moves.length === 0) return;
      ensureCalendarVisible(calendarId);
      const stepKey = (step: string, eventId: string) => `${step}:${eventId}`;
      queueMutation(
        calendarEventWrite(
          {
            key: `calendar:move-events:${moves.map((move) => move.eventId).join(",")}`,
            successToast: L.toastEventsMoved(moves.length),
            mutation: async (markCompleted) => {
              for (const move of moves) {
                move.movedToId = (await operations.createEvent(move.draft)).id;
                markCompleted(stepKey(MOVE_STEPS.create, move.eventId));
                await operations.deleteEvent(move.eventId);
                markCompleted(stepKey(MOVE_STEPS.delete, move.eventId));
              }
            },
            revert: async (completed) => {
              for (const move of moves) {
                // This move's own steps, under the names `revertEventMove` reads.
                const steps =
                  completed &&
                  new Set(
                    Object.values(MOVE_STEPS).filter((step) =>
                      completed.has(stepKey(step, move.eventId)),
                    ),
                  );
                await revertEventMove(operations, steps, move);
              }
            },
          },
          { onMutated, undoToastMessage: L.toastEventSaveUndone },
        ),
      );
    },
    [L, ensureCalendarVisible, events, onMutated, operations, organizer, queueMutation],
  );
}
