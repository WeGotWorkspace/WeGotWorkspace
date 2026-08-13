import { useCallback, useMemo, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { useAppToast } from "@/hooks/use-app-toast";
import type {
  CalendarAPIOperations,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import {
  occurrencesInRange,
  rangeToPlainDateTimeStrings,
  shiftAnchor,
  todayISODate,
  viewDateRange,
  type CalendarOccurrence,
} from "@/calendar-core/src/calendar-event-model";
import {
  calendarEventToForm,
  emptyCalendarEventForm,
  formToDraft,
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
  if (view === "month") {
    return anchor.toLocaleString(locale, MONTH_TITLE);
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

  const occurrences: CalendarOccurrence[] = useMemo(
    () =>
      occurrencesInRange(data.events, rangeToPlainDateTimeStrings(dateRange), {
        calendars: data.calendars,
        visibleCalendarIds,
      }),
    [data.events, data.calendars, dateRange, visibleCalendarIds],
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

  const openEditOccurrence = useCallback(
    (occurrence: CalendarOccurrence) => {
      // Recurring occurrences edit the master series in v1.
      const event = data.events.find((entry) => entry.id === occurrence.eventId);
      if (!event) return;
      setEditor({ mode: "edit", eventId: event.id, form: calendarEventToForm(event) });
    },
    [data.events],
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
    if (!original) return;
    const patch = formToPatch(editor.form, original);
    if (Object.keys(patch).length === 0) {
      setEditor(null);
      return;
    }
    runEditorMutation(async () => {
      await operations.patchEvent(editor.eventId, patch);
    }, L.toastEventUpdated);
  }, [editor, operations, data.events, runEditorMutation, L]);

  const deleteEditorEvent = useCallback(() => {
    if (!editor || editor.mode !== "edit" || !operations) return;
    runEditorMutation(async () => {
      await operations.deleteEvent(editor.eventId);
    }, L.toastEventDeleted);
  }, [editor, operations, runEditorMutation, L.toastEventDeleted]);

  return {
    editor,
    editorBusy,
    openCreateEvent,
    openEditOccurrence,
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
    occurrences,
    defaultCalendarId,
    operations,
  };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
