import { createElement, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { QueueMutation } from "@/hooks/use-queued-mutation";
import { splitOccurrenceKey, type CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarEventPatch } from "@/lib/models/calendar-types";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  eventIsRecurringSeries,
  exclusionRecurrenceOverrides,
  resolveSeriesRecurrenceOverrides,
  seriesRecurrenceRulesForSplit,
  truncateMasterSeriesPatch,
  type RecurrenceScopeChoice,
  type RecurrenceScopeRequest,
} from "@/calendar-core/src/calendar-recurrence-scope";

export type CalendarOccurrenceGroup = {
  eventId: string;
  /** The event as loaded, when it is (an adapter-made one may not be yet). */
  original: JmapCalendarEvent | undefined;
  /** The occurrences picked of a repeating event. */
  recurrenceIds: string[];
  /** A row stood for the event itself (not one occurrence). */
  whole: boolean;
};

/** Selected rows → their events: each master once, with the occurrences picked of it. */
export function groupOccurrenceKeys(
  keys: readonly string[],
  events: readonly JmapCalendarEvent[],
): CalendarOccurrenceGroup[] {
  const groups = new Map<string, { recurrenceIds: string[]; whole: boolean }>();
  for (const key of keys) {
    const { masterId, recurrenceId } = splitOccurrenceKey(key);
    const group = groups.get(masterId) ?? { recurrenceIds: [], whole: false };
    if (recurrenceId) group.recurrenceIds.push(recurrenceId);
    else group.whole = true;
    groups.set(masterId, group);
  }
  return [...groups].map(([eventId, group]) => ({
    eventId,
    original: events.find((entry) => entry.id === eventId),
    ...group,
  }));
}

type UseCalendarEventDeletesArgs = {
  L: CalendarUILabels;
  operations?: CalendarAPIOperations;
  events: readonly JmapCalendarEvent[];
  surfaceEvents?: CalendarEventsMap;
  queueMutation: QueueMutation;
  resolveEventId?: (engineKey: string) => Promise<string | undefined>;
  onMutated?: () => void;
  askRecurrenceScope: (request: RecurrenceScopeRequest) => Promise<RecurrenceScopeChoice | null>;
  /** Hides events (master ids, or `id::recurrenceId` occurrences) until the delete is sent. */
  setPendingDeletedEventIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** Closes the editor (called with `null`). */
  setEditor: (editor: null) => void;
  setEditorBusy: (busy: boolean) => void;
};

/**
 * Deleting events: one from its editor or preview (a repeating one asks which dates go),
 * or the rows picked in list mode. Whole events wait out the grace period with Undo.
 */
export function useCalendarEventDeletes({
  L,
  operations,
  events,
  surfaceEvents,
  queueMutation,
  resolveEventId,
  onMutated,
  askRecurrenceScope,
  setPendingDeletedEventIds,
  setEditor,
  setEditorBusy,
}: UseCalendarEventDeletesArgs) {
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const { show, showError } = useAppToast();

  const serverId = useCallback(
    async (eventId: string) =>
      events.some((entry) => entry.id === eventId)
        ? eventId
        : ((await resolveEventId?.(eventId)) ?? eventId),
    [events, resolveEventId],
  );

  /** A hard delete: the events hide now and the write waits for the grace period, so Undo only cancels it. */
  const queueHiddenDelete = useCallback(
    (hidden: readonly string[], toastMessage: string, execute: () => Promise<void>) => {
      setPendingDeletedEventIds((current) => new Set([...current, ...hidden]));
      queueMutation({
        key: `calendar:delete-events:${hidden.join(",")}`,
        toastMessage,
        icon: createElement(Trash2, { className: "size-4" }),
        irreversible: true,
        execute: async () => {
          await execute();
          onMutated?.();
        },
        undo: () =>
          setPendingDeletedEventIds((current) => {
            const next = new Set(current);
            for (const id of hidden) next.delete(id);
            return next;
          }),
        undoToastMessage: L.toastEventDeleteUndone,
      });
    },
    [L, onMutated, queueMutation, setPendingDeletedEventIds],
  );

  /** A scoped series change (only this date, this and later): sent at once, with a toast. */
  const patchSeriesNow = useCallback(
    async (eventId: string, patch: CalendarEventPatch) => {
      if (!operations) return;
      setEditorBusy(true);
      try {
        await operations.patchEvent(await serverId(eventId), patch);
        show(L.toastEventDeleted);
        onMutated?.();
      } catch {
        showError(L.toastEventSaveFailed);
      } finally {
        setEditorBusy(false);
      }
    },
    [L, onMutated, operations, serverId, setEditorBusy, show, showError],
  );

  const deleteCalendarEvent = useCallback(
    (args: { eventId: string; recurrenceId?: string; form: CalendarEventFormValue }) => {
      if (!operations) return;
      const { eventId, recurrenceId, form: editorForm } = args;
      const original = events.find((entry) => entry.id === eventId);
      const isRecurring = original ? eventIsRecurringSeries(original) : Boolean(recurrenceId);

      void (async () => {
        // Never reuse the *edit* scope for delete — delete needs All instances,
        // and choosing "only this" to open the editor must not lock delete to exclusion.
        let scope: RecurrenceScopeChoice | undefined;
        if (isRecurring && recurrenceId) {
          const asked = await askRecurrenceScope({
            action: "delete",
            masterId: eventId,
            recurrenceId,
          });
          if (!asked) return;
          scope = asked;
        }

        setEditor(null);

        if (scope === "thisInstance" && recurrenceId) {
          await patchSeriesNow(eventId, {
            recurrenceOverrides: exclusionRecurrenceOverrides(original, recurrenceId),
          });
          return;
        }

        if (scope === "thisAndFuture" && recurrenceId) {
          await patchSeriesNow(
            eventId,
            truncateMasterSeriesPatch(
              seriesRecurrenceRulesForSplit(original, editorForm),
              recurrenceId,
              Boolean(original?.showWithoutTime ?? editorForm.allDay),
              original?.start,
              resolveSeriesRecurrenceOverrides(original, eventId, surfaceEvents),
            ),
          );
          return;
        }

        // Non-recurring, master-without-occurrence, or All instances → destroy master.
        queueHiddenDelete([eventId], L.toastEventDeleted, async () => {
          await operations.deleteEvent(await serverId(eventId));
        });
      })();
    },
    [
      L,
      askRecurrenceScope,
      events,
      operations,
      patchSeriesNow,
      queueHiddenDelete,
      serverId,
      setEditor,
      surfaceEvents,
    ],
  );

  /**
   * Multi-select Delete: each selected row goes. A repeating event loses only the picked
   * occurrences (as rows they are single dates); anything else is deleted. One write with
   * Undo, sent after the grace period like a single delete.
   */
  const deleteCalendarEvents = useCallback(
    (keys: readonly string[]) => {
      if (!operations || keys.length === 0) return;
      const groups = groupOccurrenceKeys(keys, events);
      const occurrencesOnly = (group: CalendarOccurrenceGroup) =>
        !group.whole &&
        group.recurrenceIds.length > 0 &&
        (group.original ? eventIsRecurringSeries(group.original) : true);
      const hidden = groups.flatMap((group) =>
        occurrencesOnly(group)
          ? group.recurrenceIds.map((rid) => `${group.eventId}::${rid}`)
          : [group.eventId],
      );
      queueHiddenDelete(hidden, L.toastEventsDeleted(keys.length), async () => {
        for (const group of groups) {
          const targetId = await serverId(group.eventId);
          if (!occurrencesOnly(group)) {
            await operations.deleteEvent(targetId);
            continue;
          }
          // The series as it is now: an edit saved during the grace period stays.
          const series =
            eventsRef.current.find((event) => event.id === group.eventId) ?? group.original;
          let overrides = series?.recurrenceOverrides ?? {};
          for (const rid of group.recurrenceIds) {
            overrides = exclusionRecurrenceOverrides(
              series ? { ...series, recurrenceOverrides: overrides } : undefined,
              rid,
            );
          }
          await operations.patchEvent(targetId, { recurrenceOverrides: overrides });
        }
      });
    },
    [L, events, operations, queueHiddenDelete, serverId],
  );

  return { deleteCalendarEvent, deleteCalendarEvents };
}
