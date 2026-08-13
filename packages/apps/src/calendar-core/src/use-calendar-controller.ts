import { useCallback, useEffect, useMemo, useRef, useState, createElement } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type {
  CalendarAPIOperations,
  CalendarInfo,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import { shiftAnchor, todayISODate, viewDateRange } from "@/calendar-core/src/calendar-event-model";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import {
  calendarEventToForm,
  createIntentToForm,
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
import type { CalendarSurfaceCreateIntent } from "@/calendar-core/src/calendar-surface";
import type {
  CalendarCalendarDialogConfirmInput,
  CalendarCalendarDialogState,
} from "@/calendar-core/src/calendar-calendar-dialog";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import { sortCalendarsForSidebar } from "@/calendar-core/src/calendar-sidebar-order";
import type { CalendarRecurrenceScopeDialogState } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import {
  eventIsRecurringSeries,
  forkSeriesDraftFromForm,
  splitOccurrenceKey,
  truncateRecurrenceRules,
  untilBeforeRecurrenceId,
  type RecurrenceEditScope,
  type RecurrenceScopeRequest,
} from "@/calendar-core/src/calendar-recurrence-scope";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

export type CalendarEditorState =
  | { mode: "create"; form: CalendarEventFormValue }
  | {
      mode: "edit";
      eventId: string;
      form: CalendarEventFormValue;
      /** When editing a recurring occurrence. */
      recurrenceId?: string;
      recurrenceScope?: RecurrenceEditScope;
    };

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

function rangeTitle(view: CalendarViewId, anchorISO: string, locale: string): string {
  const anchor = Temporal.PlainDate.from(anchorISO);
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

function pickDefaultCalendarId(calendars: CalendarInfo[], preferred?: string): string | undefined {
  const writable = calendars.filter((c) => c.mayWrite !== false);
  if (preferred && writable.some((c) => c.id === preferred)) return preferred;
  if (preferred && calendars.some((c) => c.id === preferred)) return preferred;
  return (writable.find((c) => c.isDefault) ?? writable[0])?.id;
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
  const locale = useMemo(() => resolveLocale(undefined), []);

  const [view, setView] = useState<CalendarViewId>(initialView ?? "month");
  const [anchor, setAnchor] = useState<string>(initialAnchor ?? todayISODate());
  const viewRef = useRef(view);
  viewRef.current = view;
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarOverlayViewport());
  const [calendars, setCalendars] = useState<CalendarInfo[]>(() =>
    sortCalendarsForSidebar(data.calendars),
  );
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<ReadonlySet<string>>(
    () => new Set(data.calendars.filter((c) => c.isVisible === false).map((c) => c.id)),
  );
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | undefined>(() =>
    pickDefaultCalendarId(data.calendars),
  );
  const [pendingDeletedEventIds, setPendingDeletedEventIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [calendarDialog, setCalendarDialog] = useState<CalendarCalendarDialogState>(null);
  const [calendarDialogBusy, setCalendarDialogBusy] = useState(false);
  const [recurrenceScopeDialog, setRecurrenceScopeDialog] =
    useState<CalendarRecurrenceScopeDialogState>(null);

  useEffect(() => {
    setCalendars(sortCalendarsForSidebar(data.calendars));
  }, [data.calendars]);

  const { queueMutation, undoLatest } = useQueuedMutation({
    onMutationError: () => showError(L.toastEventSaveFailed),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (undoLatest()) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLatest]);

  const selectView = useCallback(
    (next: CalendarViewId) => {
      if (viewRef.current === next) return;
      viewRef.current = next;
      setView(next);
      // Match tasks/drive: only dismiss the overlay drawer on small viewports.
      if (isSidebarOverlayViewport()) {
        setSidebarOpen(false);
      }
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

  const ensureCalendarVisible = useCallback((calendarId: string) => {
    setHiddenCalendarIds((current) => {
      if (!current.has(calendarId)) return current;
      const next = new Set(current);
      next.delete(calendarId);
      return next;
    });
  }, []);

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
    () => new Set(calendars.filter((c) => !hiddenCalendarIds.has(c.id)).map((c) => c.id)),
    [calendars, hiddenCalendarIds],
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

  /** Sidebar create-target; falls back if the selection disappears from bootstrap data. */
  const defaultCalendarId = useMemo(
    () => pickDefaultCalendarId(calendars, selectedCalendarId),
    [calendars, selectedCalendarId],
  );

  /** Click sidebar row: set create target (and unhide if needed, matching Lit CalendarsSidebar). */
  const selectDefaultCalendar = useCallback(
    (calendarId: string) => {
      if (!calendars.some((c) => c.id === calendarId)) return;
      ensureCalendarVisible(calendarId);
      setSelectedCalendarId(calendarId);
    },
    [calendars, ensureCalendarVisible],
  );

  const [editor, setEditor] = useState<CalendarEditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);

  const openCreateEvent = useCallback(
    (dateISO?: string, startTime?: string) => {
      if (!defaultCalendarId) return;
      ensureCalendarVisible(defaultCalendarId);
      setEditor({
        mode: "create",
        form: emptyCalendarEventForm(defaultCalendarId, dateISO ?? anchor, startTime),
      });
    },
    [defaultCalendarId, anchor, ensureCalendarVisible],
  );

  /** Drag/click create from the Lit surface — dialog only; nothing persisted yet. */
  const openCreateFromSurface = useCallback(
    (intent: CalendarSurfaceCreateIntent) => {
      const calendarId = intent.calendarId || defaultCalendarId;
      if (!calendarId) return;
      ensureCalendarVisible(calendarId);
      setEditor({
        mode: "create",
        form: createIntentToForm(calendarId, intent),
      });
    },
    [defaultCalendarId, ensureCalendarVisible],
  );

  const askRecurrenceScope = useCallback((request: RecurrenceScopeRequest) => {
    return new Promise<RecurrenceEditScope | null>((resolve) => {
      setRecurrenceScopeDialog({
        action: request.action === "update" ? "edit" : request.action,
        resolve: (scope) => {
          setRecurrenceScopeDialog(null);
          resolve(scope);
        },
      });
    });
  }, []);

  const openEditEventKey = useCallback(
    async (key: string) => {
      const { masterId, recurrenceId } = splitOccurrenceKey(key);
      if (pendingDeletedEventIds.has(masterId)) return;

      const wireEvent = data.events.find((entry) => entry.id === masterId);
      const engineEvent = surfaceEvents?.get(masterId) ?? surfaceEvents?.get(key);
      const form = wireEvent
        ? calendarEventToForm(wireEvent)
        : engineEvent
          ? engineEventToForm(engineEvent)
          : null;
      if (!form) return;

      const isRecurring = wireEvent
        ? eventIsRecurringSeries(wireEvent)
        : Boolean(engineEvent?.data.recurrenceRule);
      let recurrenceScope: RecurrenceEditScope | undefined;
      if (isRecurring && recurrenceId) {
        const scope = await askRecurrenceScope({
          action: "edit",
          masterId,
          recurrenceId,
        });
        if (!scope) return;
        recurrenceScope = scope;
      }

      setEditor({
        mode: "edit",
        eventId: masterId,
        form,
        ...(recurrenceId ? { recurrenceId } : {}),
        ...(recurrenceScope ? { recurrenceScope } : {}),
      });
    },
    [data.events, surfaceEvents, pendingDeletedEventIds, askRecurrenceScope],
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
      ensureCalendarVisible(editor.form.calendarId);
      runEditorMutation(async () => {
        await operations.createEvent(formToDraft(editor.form));
      }, L.toastEventCreated);
      return;
    }
    const original = data.events.find((entry) => entry.id === editor.eventId);
    const patch = original ? formToPatch(editor.form, original) : formToFullPatch(editor.form);

    // This-and-future: truncate the master series, then create a forked series.
    if (editor.recurrenceScope === "thisAndFuture" && editor.recurrenceId) {
      ensureCalendarVisible(editor.form.calendarId);
      runEditorMutation(async () => {
        const targetId = original
          ? editor.eventId
          : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
        const allDay = Boolean(original?.showWithoutTime ?? editor.form.allDay);
        const until = untilBeforeRecurrenceId(editor.recurrenceId!, allDay);
        await operations.patchEvent(targetId, {
          recurrenceRules: truncateRecurrenceRules(original?.recurrenceRules, until),
        });
        await operations.createEvent(
          forkSeriesDraftFromForm(editor.form, original?.recurrenceRules),
        );
      }, L.toastEventUpdated);
      return;
    }

    if (Object.keys(patch).length === 0) {
      setEditor(null);
      return;
    }
    ensureCalendarVisible(editor.form.calendarId);
    runEditorMutation(async () => {
      const targetId = original
        ? editor.eventId
        : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
      if (patch.calendarId) {
        await operations.createEvent(formToDraft(editor.form));
        await operations.deleteEvent(targetId);
        return;
      }
      await operations.patchEvent(targetId, patch);
    }, L.toastEventUpdated);
  }, [
    editor,
    operations,
    data.events,
    runEditorMutation,
    resolveEventId,
    ensureCalendarVisible,
    L,
  ]);

  const deleteEditorEvent = useCallback(() => {
    if (!editor || editor.mode !== "edit" || !operations) return;
    const eventId = editor.eventId;
    const recurrenceId = editor.recurrenceId;
    const recurrenceScope = editor.recurrenceScope;
    const isWireEvent = data.events.some((entry) => entry.id === eventId);
    const original = data.events.find((entry) => entry.id === eventId);
    const isRecurring = original ? eventIsRecurringSeries(original) : Boolean(recurrenceId);

    void (async () => {
      let scope = recurrenceScope;
      if (isRecurring && !scope) {
        const asked = await askRecurrenceScope({
          action: "delete",
          masterId: eventId,
          recurrenceId,
        });
        if (!asked) return;
        scope = asked;
      }

      setEditor(null);

      if (scope === "thisAndFuture" && recurrenceId) {
        const allDay = Boolean(original?.showWithoutTime);
        const until = untilBeforeRecurrenceId(recurrenceId, allDay);
        setEditorBusy(true);
        try {
          const targetId = isWireEvent ? eventId : ((await resolveEventId?.(eventId)) ?? eventId);
          await operations.patchEvent(targetId, {
            recurrenceRules: truncateRecurrenceRules(original?.recurrenceRules, until),
          });
          show(L.toastEventDeleted);
          onMutated?.();
        } catch {
          showError(L.toastEventSaveFailed);
        } finally {
          setEditorBusy(false);
        }
        return;
      }

      setPendingDeletedEventIds((current) => {
        const next = new Set(current);
        next.add(eventId);
        return next;
      });

      const rollback = () => {
        setPendingDeletedEventIds((current) => {
          if (!current.has(eventId)) return current;
          const next = new Set(current);
          next.delete(eventId);
          return next;
        });
      };

      queueMutation({
        key: `calendar:delete-event:${eventId}`,
        toastMessage: L.toastEventDeleted,
        icon: createElement(Trash2, { className: "size-4" }),
        execute: async () => {
          const targetId = isWireEvent ? eventId : ((await resolveEventId?.(eventId)) ?? eventId);
          await operations.deleteEvent(targetId);
          onMutated?.();
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: L.toastEventDeleteUndone,
      });
    })();
  }, [
    editor,
    operations,
    data.events,
    queueMutation,
    resolveEventId,
    onMutated,
    askRecurrenceScope,
    show,
    showError,
    L.toastEventDeleted,
    L.toastEventDeleteUndone,
    L.toastEventSaveFailed,
  ]);

  const canCreateCalendar = Boolean(operations?.createCalendar);
  const openCreateCalendarDialog = useCallback(() => {
    if (!canCreateCalendar) return;
    setCalendarDialog({ mode: "create" });
  }, [canCreateCalendar]);

  const openEditCalendarDialog = useCallback(
    (calendarId: string) => {
      const calendar = calendars.find((entry) => entry.id === calendarId);
      if (!calendar) return;
      const mayEdit = calendar.mayWrite !== false;
      const mayDelete = calendar.mayDelete !== false && Boolean(operations?.deleteCalendar);
      if (!mayEdit && !mayDelete) return;
      setCalendarDialog({
        mode: "edit",
        calendarId: calendar.id,
        name: calendar.name,
        color: calendar.color || DEFAULT_CALENDAR_COLOR,
        mayDelete,
      });
    },
    [calendars, operations?.deleteCalendar],
  );

  const closeCalendarDialog = useCallback(() => {
    if (!calendarDialogBusy) setCalendarDialog(null);
  }, [calendarDialogBusy]);

  const saveCalendarDialog = useCallback(
    (input: CalendarCalendarDialogConfirmInput) => {
      if (!operations || !calendarDialog) return;
      const name = input.name.trim();
      const color = input.color.trim() || DEFAULT_CALENDAR_COLOR;
      if (!name) return;

      setCalendarDialogBusy(true);
      void (async () => {
        try {
          if (calendarDialog.mode === "create") {
            if (!operations.createCalendar) return;
            const created = await operations.createCalendar({ name, color });
            setCalendars((prev) => sortCalendarsForSidebar([...prev, created]));
            selectDefaultCalendar(created.id);
            show(L.toastCalendarCreated);
            setCalendarDialog(null);
            onMutated?.();
            return;
          }
          if (!operations.patchCalendar) return;
          const updated = await operations.patchCalendar(calendarDialog.calendarId, {
            name,
            color,
          });
          setCalendars((prev) =>
            sortCalendarsForSidebar(
              prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)),
            ),
          );
          show(L.toastCalendarUpdated);
          setCalendarDialog(null);
          onMutated?.();
        } catch {
          showError(L.toastCalendarSaveFailed);
        } finally {
          setCalendarDialogBusy(false);
        }
      })();
    },
    [
      operations,
      calendarDialog,
      selectDefaultCalendar,
      show,
      showError,
      onMutated,
      L.toastCalendarCreated,
      L.toastCalendarUpdated,
      L.toastCalendarSaveFailed,
    ],
  );

  const deleteCalendarFromDialog = useCallback(() => {
    const deleteCalendar = operations?.deleteCalendar;
    if (!deleteCalendar || calendarDialog?.mode !== "edit") return;
    const calendarId = calendarDialog.calendarId;
    setCalendarDialogBusy(true);
    void (async () => {
      try {
        await deleteCalendar(calendarId);
        setCalendars((prev) => {
          const next = prev.filter((entry) => entry.id !== calendarId);
          const nextDefault = pickDefaultCalendarId(next);
          setSelectedCalendarId(nextDefault);
          return sortCalendarsForSidebar(next);
        });
        setHiddenCalendarIds((current) => {
          if (!current.has(calendarId)) return current;
          const next = new Set(current);
          next.delete(calendarId);
          return next;
        });
        show(L.toastCalendarDeleted);
        setCalendarDialog(null);
        onMutated?.();
      } catch {
        showError(L.toastCalendarSaveFailed);
      } finally {
        setCalendarDialogBusy(false);
      }
    })();
  }, [
    operations,
    calendarDialog,
    show,
    showError,
    onMutated,
    L.toastCalendarDeleted,
    L.toastCalendarSaveFailed,
  ]);

  const truncateSeriesFromOccurrence = useCallback(
    async (args: { masterId: string; recurrenceId: string; allDay?: boolean }) => {
      if (!operations?.patchEvent) return;
      const original = data.events.find((entry) => entry.id === args.masterId);
      const until = untilBeforeRecurrenceId(args.recurrenceId, Boolean(args.allDay));
      try {
        const targetId = (await resolveEventId?.(args.masterId)) ?? args.masterId;
        await operations.patchEvent(targetId, {
          recurrenceRules: truncateRecurrenceRules(original?.recurrenceRules, until),
        });
        show(L.toastEventDeleted);
        onMutated?.();
      } catch {
        showError(L.toastEventSaveFailed);
      }
    },
    [
      operations,
      data.events,
      resolveEventId,
      show,
      showError,
      onMutated,
      L.toastEventDeleted,
      L.toastEventSaveFailed,
    ],
  );

  const surfaceEventsForView = useMemo(() => {
    if (!surfaceEvents || pendingDeletedEventIds.size === 0) return surfaceEvents;
    const next = new Map(surfaceEvents);
    for (const id of pendingDeletedEventIds) {
      next.delete(id);
      for (const key of [...next.keys()]) {
        if (key.startsWith(`${id}::`)) next.delete(key);
      }
    }
    return next;
  }, [surfaceEvents, pendingDeletedEventIds]);

  return {
    editor,
    editorBusy,
    openCreateEvent,
    openCreateFromSurface,
    openEditEventKey,
    closeEditor,
    setEditorForm,
    saveEditor,
    deleteEditorEvent,
    L,
    locale,
    view,
    selectView,
    anchor,
    setAnchor,
    dateRange,
    title: rangeTitle(view, anchor, locale),
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
    ensureCalendarVisible,
    selectDefaultCalendar,
    visibleCalendarIds,
    litSurface,
    defaultCalendarId,
    operations,
    canCreateCalendar,
    calendarDialog,
    calendarDialogBusy,
    openCreateCalendarDialog,
    openEditCalendarDialog,
    closeCalendarDialog,
    saveCalendarDialog,
    deleteCalendarFromDialog,
    undoLatest,
    surfaceEventsForView,
    pendingDeletedEventIds,
    askRecurrenceScope,
    recurrenceScopeDialog,
    truncateSeriesFromOccurrence,
  };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
