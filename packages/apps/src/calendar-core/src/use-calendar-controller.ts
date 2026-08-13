import { useCallback, useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { useAppToast } from "@/hooks/use-app-toast";
import type {
  CalendarAPIOperations,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import { shiftAnchor, todayISODate, viewDateRange } from "@/calendar-core/src/calendar-event-model";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import {
  calendarEventToForm,
  emptyCalendarEventForm,
  engineEventToForm,
  formToDraft,
  formToFullPatch,
  formToPatch,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import {
  defaultCalendarLabels,
  mergeCalendarLabels,
  type CalendarUILabels,
} from "@/calendar-core/src/calendar-labels";

export type CalendarEditorState =
  | { mode: "create"; form: CalendarEventFormValue }
  | { mode: "edit"; eventId: string; form: CalendarEventFormValue };

export type UseCalendarControllerOptions = {
  data: CalendarUIData;
  labels?: Partial<CalendarUILabels>;
  operations?: CalendarAPIOperations;
  initialView?: CalendarViewId;
  initialAnchor?: string;
  onViewChange?: (view: CalendarViewId) => void;
  /** Adapter-backed engine events — editor fallback for events not yet in the bootstrap. */
  surfaceEvents?: CalendarEventsMap;
  /** Resolves an engine key to its server-side JMAP id (adapter-created events). */
  resolveEventId?: (engineKey: string) => Promise<string | undefined>;
  /** Called after a successful create/update/delete (e.g. to refresh the bootstrap). */
  onMutated?: () => void;
};

const MONTH_TITLE: Temporal.ToStringPrecisionOptions & Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
};

function rangeTitle(view: CalendarViewId, anchorISO: string): string {
  const anchor = Temporal.PlainDate.from(anchorISO);
  const locale = undefined;
  if (view === "month" || view === "agenda") {
    return anchor.toLocaleString(locale, MONTH_TITLE);
  }
  if (view === "year") {
    return String(anchor.year);
  }
  if (view === "day") {
    return anchor.toLocaleString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  const range = viewDateRange(view, anchorISO);
  const last = range.end.subtract({ days: 1 });
  const sameMonth = range.start.month === last.month && range.start.year === last.year;
  const startLabel = range.start.toLocaleString(locale, { day: "numeric", month: "short" });
  const endLabel = last.toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return sameMonth
    ? `${range.start.day}–${last.day} ${last.toLocaleString(locale, { month: "long", year: "numeric" })}`
    : `${startLabel} – ${endLabel}`;
}

export function useCalendarController({
  data,
  labels,
  operations,
  initialView,
  initialAnchor,
  onViewChange,
  surfaceEvents,
  resolveEventId,
  onMutated,
}: UseCalendarControllerOptions) {
  const L = useMemo(() => (labels ? mergeCalendarLabels(labels) : defaultCalendarLabels), [labels]);
  const { show, showError } = useAppToast();

  const [view, setView] = useState<CalendarViewId>(initialView ?? "month");
  const [anchor, setAnchor] = useState<string>(initialAnchor ?? todayISODate());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<ReadonlySet<string>>(
    () => new Set(data.calendars.filter((c) => c.isVisible === false).map((c) => c.id)),
  );

  const selectView = useCallback(
    (next: CalendarViewId) => {
      setView(next);
      setSidebarOpen(false);
      onViewChange?.(next);
    },
    [onViewChange],
  );

  const goToday = useCallback(() => setAnchor(todayISODate()), []);
  const goPrevious = useCallback(
    () => setAnchor((current) => shiftAnchor(view, current, -1)),
    [view],
  );
  const goNext = useCallback(() => setAnchor((current) => shiftAnchor(view, current, 1)), [view]);

  const toggleCalendarVisibility = useCallback((calendarId: string) => {
    setHiddenCalendarIds((current) => {
      const next = new Set(current);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  }, []);

  const visibleCalendarIds = useMemo(
    () => new Set(data.calendars.filter((c) => !hiddenCalendarIds.has(c.id)).map((c) => c.id)),
    [data.calendars, hiddenCalendarIds],
  );

  const dateRange = useMemo(() => viewDateRange(view, anchor), [view, anchor]);

  /** The vendored lit views take a view id + presentation; agenda = list over the month. */
  const litSurface = useMemo(
    () =>
      view === "agenda"
        ? ({ view: "month", presentation: "list" } as const)
        : ({ view, presentation: "grid" } as const),
    [view],
  );

  const defaultCalendarId = useMemo(() => {
    const writable = data.calendars.filter((c) => c.mayWrite !== false);
    return (writable.find((c) => c.isDefault) ?? writable[0])?.id;
  }, [data.calendars]);

  const [editor, setEditor] = useState<CalendarEditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);

  const openCreateEvent = useCallback(
    (dateISO?: string, startTime?: string) => {
      if (!defaultCalendarId) return;
      setEditor({
        mode: "create",
        form: emptyCalendarEventForm(defaultCalendarId, dateISO ?? anchor, startTime),
      });
    },
    [defaultCalendarId, anchor],
  );

  const openEditEventKey = useCallback(
    (key: string) => {
      // Engine keys detached exceptions as `${masterId}::${recurrenceId}`;
      // recurring occurrences edit the master series in v1.
      const separator = key.indexOf("::");
      const masterId = separator === -1 ? key : key.slice(0, separator);
      const wireEvent = data.events.find((entry) => entry.id === masterId);
      if (wireEvent) {
        setEditor({ mode: "edit", eventId: wireEvent.id, form: calendarEventToForm(wireEvent) });
        return;
      }
      // Not in the bootstrap snapshot (e.g. drag-created via the adapter):
      // build the form from the engine event instead.
      const engineEvent = surfaceEvents?.get(masterId) ?? surfaceEvents?.get(key);
      if (!engineEvent) return;
      setEditor({ mode: "edit", eventId: masterId, form: engineEventToForm(engineEvent) });
    },
    [data.events, surfaceEvents],
  );

  const closeEditor = useCallback(() => {
    if (!editorBusy) setEditor(null);
  }, [editorBusy]);

  const setEditorForm = useCallback((form: CalendarEventFormValue) => {
    setEditor((current) => (current ? { ...current, form } : current));
  }, []);

  const runEditorMutation = useCallback(
    (mutation: () => Promise<void>, successToast: string) => {
      if (!operations) return;
      setEditorBusy(true);
      void (async () => {
        try {
          await mutation();
          setEditor(null);
          show(successToast);
          onMutated?.();
        } catch {
          showError(L.toastEventSaveFailed);
        } finally {
          setEditorBusy(false);
        }
      })();
    },
    [operations, show, showError, onMutated, L.toastEventSaveFailed],
  );

  const saveEditor = useCallback(() => {
    if (!editor || !operations) return;
    if (editor.mode === "create") {
      runEditorMutation(async () => {
        await operations.createEvent(formToDraft(editor.form));
      }, L.toastEventCreated);
      return;
    }
    const original = data.events.find((entry) => entry.id === editor.eventId);
    // Without the wire original (engine-fallback edit) send the full field set.
    const patch = original ? formToPatch(editor.form, original) : formToFullPatch(editor.form);
    if (Object.keys(patch).length === 0) {
      setEditor(null);
      return;
    }
    runEditorMutation(async () => {
      // Engine keys of adapter-created events resolve to their server id here.
      const targetId = original
        ? editor.eventId
        : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
      await operations.patchEvent(targetId, patch);
    }, L.toastEventUpdated);
  }, [editor, operations, data.events, runEditorMutation, resolveEventId, L]);

  const deleteEditorEvent = useCallback(() => {
    if (!editor || editor.mode !== "edit" || !operations) return;
    runEditorMutation(async () => {
      const isWireEvent = data.events.some((entry) => entry.id === editor.eventId);
      const targetId = isWireEvent
        ? editor.eventId
        : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
      await operations.deleteEvent(targetId);
    }, L.toastEventDeleted);
  }, [editor, operations, data.events, runEditorMutation, resolveEventId, L.toastEventDeleted]);

  return {
    editor,
    editorBusy,
    openCreateEvent,
    openEditEventKey,
    closeEditor,
    setEditorForm,
    saveEditor,
    deleteEditorEvent,
    L,
    view,
    selectView,
    anchor,
    setAnchor,
    dateRange,
    title: rangeTitle(view, anchor),
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars: data.calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
    visibleCalendarIds,
    litSurface,
    defaultCalendarId,
    operations,
  };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
