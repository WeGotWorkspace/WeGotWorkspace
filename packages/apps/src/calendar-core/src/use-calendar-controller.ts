import { useCallback, useEffect, useMemo, useRef, useState, createElement } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type {
  CalendarAPIOperations,
  CalendarEventDraft,
  CalendarInfo,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import { shiftAnchor, todayISODate, viewDateRange } from "@/calendar-core/src/calendar-event-model";
import {
  calendarRangeLabel,
  type CalendarRangeLabelDensity,
} from "@/lib/calendar-elements/CalendarViewGroup/calendar-range-label";
import {
  calendarRouteKey,
  DEFAULT_CALENDAR_PRESENTATION,
  DEFAULT_CALENDAR_VIEW,
  type CalendarRouteState,
} from "@/calendar-core/src/calendar-route-search";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import {
  createIntentToForm,
  emptyCalendarEventForm,
  engineEventToForm,
  formToDraft,
  formToFullPatch,
  formToPatch,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import { alertsFromWire, freeBusyStatusFromWire } from "@/calendar-core/src/calendar-alerts";
import { normalizeEventTimeZone } from "@/calendar-core/src/calendar-timezones";
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
  exclusionRecurrenceOverrides,
  forkSeriesDraftWithSplitOverrides,
  occurrenceRecurrenceOverrides,
  resolveRecurrenceMasterRef,
  resolveSeriesRecurrenceOverrides,
  seriesRecurrenceRulesForSplit,
  truncateMasterSeriesPatch,
  type RecurrenceEditScope,
  type RecurrenceScopeChoice,
  type RecurrenceScopeRequest,
} from "@/calendar-core/src/calendar-recurrence-scope";
import { resolveCalendarEventPreview } from "@/calendar-core/src/calendar-event-preview";
import { resolveLocale } from "@/lib/calendar-elements/utils/Locale";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

export type CalendarEditorState =
  | { mode: "create"; form: CalendarEventFormValue }
  | {
      mode: "edit";
      eventId: string;
      form: CalendarEventFormValue;
      /** When editing a recurring occurrence — scope is chosen at Save/Delete. */
      recurrenceId?: string;
    };

export type UseCalendarControllerOptions = {
  data: CalendarUIData;
  labels?: Partial<CalendarUILabels>;
  operations?: CalendarAPIOperations;
  initialView?: CalendarViewId;
  /** Grid vs list for the selected time range (independent of `initialView`). */
  initialPresentation?: CalendarPresentation;
  initialAnchor?: string;
  onViewChange?: (view: CalendarViewId) => void;
  /** App-owned path sync — do not call router APIs from this hook. */
  onRouteStateChange?: (state: CalendarRouteState, options?: { replace?: boolean }) => void;
  /** Adapter-backed engine events — editor fallback for events not yet in the bootstrap. */
  surfaceEvents?: CalendarEventsMap;
  /** Resolves an engine key to its server-side JMAP id (adapter-created events). */
  resolveEventId?: (engineKey: string) => Promise<string | undefined>;
  /** Called after a successful create/update/delete (e.g. to refresh the bootstrap). */
  onMutated?: () => void;
  sessionEmail?: string;
  sessionName?: string;
};

function rangeTitle(
  view: CalendarViewId,
  anchorISO: string,
  locale: string,
  density: CalendarRangeLabelDensity = "full",
): string {
  const anchor = Temporal.PlainDate.from(anchorISO);
  if (view !== "week") {
    return calendarRangeLabel({ view, anchor, locale, density });
  }
  const range = viewDateRange(view, anchorISO);
  return calendarRangeLabel({
    view,
    anchor,
    locale,
    density,
    weekStart: range.start,
    weekEnd: range.end.subtract({ days: 1 }),
  });
}

function draftFromForm(
  form: CalendarEventFormValue,
  organizer?: { email: string; name?: string },
): CalendarEventDraft {
  const draft = formToDraft(form);
  return organizer ? { ...draft, organizer } : draft;
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
  initialPresentation = DEFAULT_CALENDAR_PRESENTATION,
  initialAnchor,
  onViewChange,
  onRouteStateChange,
  surfaceEvents,
  resolveEventId,
  onMutated,
  sessionEmail,
  sessionName,
}: UseCalendarControllerOptions) {
  const L = useMemo(() => (labels ? mergeCalendarLabels(labels) : defaultCalendarLabels), [labels]);
  const { show, showError } = useAppToast();
  const locale = useMemo(() => resolveLocale(undefined), []);

  const [view, setView] = useState<CalendarViewId>(initialView ?? DEFAULT_CALENDAR_VIEW);
  const [presentation, setPresentationState] = useState<CalendarPresentation>(initialPresentation);
  const [anchor, setAnchorState] = useState<string>(initialAnchor ?? todayISODate());
  const viewRef = useRef(view);
  viewRef.current = view;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const pendingRouteKeyRef = useRef<string | null>(null);
  const lastInitialRouteKeyRef = useRef(
    calendarRouteKey({
      view: initialView ?? DEFAULT_CALENDAR_VIEW,
      date: initialAnchor ?? todayISODate(),
      presentation: initialPresentation,
    }),
  );
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
  const pendingScopeResolveRef = useRef<((scope: RecurrenceScopeChoice | null) => void) | null>(
    null,
  );

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

  const currentRouteState = useCallback((): CalendarRouteState => {
    return {
      view: viewRef.current,
      date: anchorRef.current,
      presentation: presentationRef.current,
    };
  }, []);

  const onRouteStateChangeRef = useRef(onRouteStateChange);
  onRouteStateChangeRef.current = onRouteStateChange;

  const emitRouteState = useCallback((next: CalendarRouteState, replace = false) => {
    pendingRouteKeyRef.current = calendarRouteKey(next);
    onRouteStateChangeRef.current?.(next, { replace });
  }, []);

  useEffect(() => {
    const incoming: CalendarRouteState = {
      view: initialView ?? DEFAULT_CALENDAR_VIEW,
      date: initialAnchor ?? todayISODate(),
      presentation: initialPresentation,
    };
    const incomingKey = calendarRouteKey(incoming);
    const pending = pendingRouteKeyRef.current;
    const initialsChanged = lastInitialRouteKeyRef.current !== incomingKey;
    lastInitialRouteKeyRef.current = incomingKey;

    if (pending !== null) {
      if (incomingKey === pending) {
        pendingRouteKeyRef.current = null;
        return;
      }
      if (!initialsChanged) return;
      pendingRouteKeyRef.current = null;
    }
    if (!initialsChanged) return;

    viewRef.current = incoming.view;
    presentationRef.current = incoming.presentation;
    anchorRef.current = incoming.date;
    setView(incoming.view);
    setPresentationState(incoming.presentation);
    setAnchorState(incoming.date);
  }, [initialView, initialPresentation, initialAnchor]);

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
      emitRouteState(currentRouteState());
    },
    [onViewChange, emitRouteState, currentRouteState],
  );

  const setPresentation = useCallback(
    (next: CalendarPresentation) => {
      if (presentationRef.current === next) return;
      presentationRef.current = next;
      setPresentationState(next);
      emitRouteState(currentRouteState());
    },
    [emitRouteState, currentRouteState],
  );

  const setAnchor = useCallback(
    (next: string) => {
      if (anchorRef.current === next) return;
      anchorRef.current = next;
      setAnchorState(next);
      emitRouteState(currentRouteState(), true);
    },
    [emitRouteState, currentRouteState],
  );

  const goToday = useCallback(() => {
    const next = todayISODate();
    if (anchorRef.current === next) return;
    anchorRef.current = next;
    setAnchorState(next);
    emitRouteState(currentRouteState());
  }, [emitRouteState, currentRouteState]);

  const goPrevious = useCallback(() => {
    const next = shiftAnchor(viewRef.current, anchorRef.current, -1);
    if (anchorRef.current === next) return;
    anchorRef.current = next;
    setAnchorState(next);
    emitRouteState(currentRouteState());
  }, [emitRouteState, currentRouteState]);

  const goNext = useCallback(() => {
    const next = shiftAnchor(viewRef.current, anchorRef.current, 1);
    if (anchorRef.current === next) return;
    anchorRef.current = next;
    setAnchorState(next);
    emitRouteState(currentRouteState());
  }, [emitRouteState, currentRouteState]);

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

  /** Lit surface mirrors time-range `view` and independent grid/list `presentation`. */
  const litSurface = useMemo(() => ({ view, presentation }) as const, [view, presentation]);

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
    return new Promise<RecurrenceScopeChoice | null>((resolve) => {
      // Replace any in-flight prompt so Lit drag and click never hang on an orphaned Promise.
      const previous = pendingScopeResolveRef.current;
      pendingScopeResolveRef.current = null;
      previous?.(null);

      let settled = false;
      const settle = (scope: RecurrenceScopeChoice | null) => {
        if (settled) return;
        settled = true;
        if (pendingScopeResolveRef.current === settle) {
          pendingScopeResolveRef.current = null;
        }
        setRecurrenceScopeDialog(null);
        resolve(scope);
      };
      pendingScopeResolveRef.current = settle;

      // Defer open past the initiating pointer gesture so Radix does not treat it as dismiss.
      window.setTimeout(() => {
        if (settled) return;
        setRecurrenceScopeDialog({
          action: request.action === "update" ? "edit" : request.action,
          ...(request.description ? { description: request.description } : {}),
          resolve: settle,
        });
      }, 0);
    });
  }, []);

  const openEditEventKey = useCallback(
    async (key: string) => {
      const preview = resolveCalendarEventPreview(key, {
        events: data.events,
        surfaceEvents,
        pendingDeletedEventIds,
      });
      if (!preview) return;

      // Open the editor immediately — recurrence scope is chosen on Save / Delete.
      setEditor({
        mode: "edit",
        eventId: preview.eventId,
        form: preview.form,
        ...(preview.recurrenceId ? { recurrenceId: preview.recurrenceId } : {}),
      });
    },
    [data.events, surfaceEvents, pendingDeletedEventIds],
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
        await operations.createEvent(
          draftFromForm(
            editor.form,
            sessionEmail ? { email: sessionEmail, name: sessionName || sessionEmail } : undefined,
          ),
        );
      }, L.toastEventCreated);
      return;
    }

    void (async () => {
      const original = data.events.find((entry) => entry.id === editor.eventId);
      const patch = original ? formToPatch(editor.form, original) : formToFullPatch(editor.form);
      const organizer = sessionEmail
        ? { email: sessionEmail, name: sessionName || sessionEmail }
        : undefined;
      if (patch.attendees && organizer) {
        patch.organizer = organizer;
      }
      const isRecurring = original
        ? eventIsRecurringSeries(original)
        : Boolean(editor.recurrenceId);

      let recurrenceScope: RecurrenceEditScope | undefined;
      if (isRecurring && editor.recurrenceId) {
        const asked = await askRecurrenceScope({
          action: "edit",
          masterId: editor.eventId,
          recurrenceId: editor.recurrenceId,
        });
        if (asked !== "thisInstance" && asked !== "thisAndFuture") return;
        recurrenceScope = asked;
      }

      // Only-this-instance: persist a JSCalendar recurrenceOverrides patch on the master.
      if (recurrenceScope === "thisInstance" && editor.recurrenceId) {
        if (!original) {
          showError(L.toastEventSaveFailed);
          return;
        }
        const overrides = occurrenceRecurrenceOverrides(editor.form, original, editor.recurrenceId);
        if (!overrides) {
          setEditor(null);
          return;
        }
        ensureCalendarVisible(editor.form.calendarId);
        runEditorMutation(async () => {
          const targetId = (await resolveEventId?.(editor.eventId)) ?? editor.eventId;
          await operations.patchEvent(targetId, { recurrenceOverrides: overrides });
        }, L.toastEventUpdated);
        return;
      }

      // This-and-future: truncate the master series, then create a forked series.
      if (recurrenceScope === "thisAndFuture" && editor.recurrenceId) {
        ensureCalendarVisible(editor.form.calendarId);
        const masterEngine = surfaceEvents?.get(editor.eventId);
        // Prefer wire → surface master (true series rule) → occurrence form preset.
        const seriesRules = original?.recurrenceRules?.length
          ? original.recurrenceRules
          : masterEngine
            ? seriesRecurrenceRulesForSplit(undefined, engineEventToForm(masterEngine))
            : seriesRecurrenceRulesForSplit(undefined, editor.form);
        runEditorMutation(async () => {
          const targetId = original
            ? editor.eventId
            : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
          const allDay = Boolean(original?.showWithoutTime ?? editor.form.allDay);
          // Adapter rows are fresher than bootstrap after only-this — partition from those.
          const seriesOverrides = resolveSeriesRecurrenceOverrides(
            original,
            editor.eventId,
            surfaceEvents,
          );
          await operations.patchEvent(
            targetId,
            truncateMasterSeriesPatch(
              seriesRules,
              editor.recurrenceId!,
              allDay,
              original?.start,
              seriesOverrides,
            ),
          );
          await operations.createEvent(
            forkSeriesDraftWithSplitOverrides(
              editor.form,
              seriesRules,
              original,
              editor.recurrenceId!,
              seriesOverrides,
            ),
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
          await operations.createEvent(
            draftFromForm(
              editor.form,
              sessionEmail ? { email: sessionEmail, name: sessionName || sessionEmail } : undefined,
            ),
          );
          await operations.deleteEvent(targetId);
          return;
        }
        await operations.patchEvent(targetId, patch);
      }, L.toastEventUpdated);
    })();
  }, [
    editor,
    operations,
    data.events,
    surfaceEvents,
    runEditorMutation,
    resolveEventId,
    ensureCalendarVisible,
    askRecurrenceScope,
    showError,
    L,
    sessionEmail,
    sessionName,
  ]);

  const deleteEditorEvent = useCallback(() => {
    if (!editor || editor.mode !== "edit" || !operations) return;
    const eventId = editor.eventId;
    const recurrenceId = editor.recurrenceId;
    const editorForm = editor.form;
    const isWireEvent = data.events.some((entry) => entry.id === eventId);
    const original = data.events.find((entry) => entry.id === eventId);
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
        setEditorBusy(true);
        try {
          const targetId = isWireEvent ? eventId : ((await resolveEventId?.(eventId)) ?? eventId);
          await operations.patchEvent(targetId, {
            recurrenceOverrides: exclusionRecurrenceOverrides(original, recurrenceId),
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

      if (scope === "thisAndFuture" && recurrenceId) {
        const allDay = Boolean(original?.showWithoutTime ?? editorForm.allDay);
        const seriesRules = seriesRecurrenceRulesForSplit(original, editorForm);
        setEditorBusy(true);
        try {
          const targetId = isWireEvent ? eventId : ((await resolveEventId?.(eventId)) ?? eventId);
          await operations.patchEvent(
            targetId,
            truncateMasterSeriesPatch(
              seriesRules,
              recurrenceId,
              allDay,
              original?.start,
              resolveSeriesRecurrenceOverrides(original, eventId, surfaceEvents),
            ),
          );
          show(L.toastEventDeleted);
          onMutated?.();
        } catch {
          showError(L.toastEventSaveFailed);
        } finally {
          setEditorBusy(false);
        }
        return;
      }

      // Non-recurring, master-without-occurrence, or All instances → destroy master.
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
    surfaceEvents,
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
        scope: calendar.scope === "group" ? "group" : "personal",
        groupSlug: calendar.groupSlug ?? null,
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
            const created = await operations.createCalendar({
              name,
              color,
              ...(input.groupSlug?.trim() ? { groupSlug: input.groupSlug.trim() } : {}),
            });
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
              prev.map((entry) =>
                entry.id === updated.id
                  ? {
                      ...entry,
                      ...updated,
                      color: updated.color || color,
                      name: updated.name || name,
                    }
                  : entry,
              ),
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
      const { masterKey, original, masterEngine } = resolveRecurrenceMasterRef(
        args.masterId,
        data.events,
        surfaceEvents,
      );
      const seriesRules = original?.recurrenceRules?.length
        ? original.recurrenceRules
        : masterEngine
          ? seriesRecurrenceRulesForSplit(undefined, engineEventToForm(masterEngine))
          : null;
      try {
        const targetId = (await resolveEventId?.(masterKey)) ?? masterKey;
        await operations.patchEvent(
          targetId,
          truncateMasterSeriesPatch(
            seriesRules,
            args.recurrenceId,
            Boolean(args.allDay ?? original?.showWithoutTime),
            original?.start,
            resolveSeriesRecurrenceOverrides(original, masterKey, surfaceEvents),
          ),
        );
        show(L.toastEventDeleted);
        onMutated?.();
      } catch {
        showError(L.toastEventSaveFailed);
      }
    },
    [
      operations,
      data.events,
      surfaceEvents,
      resolveEventId,
      show,
      showError,
      onMutated,
      L.toastEventDeleted,
      L.toastEventSaveFailed,
    ],
  );

  /** Drag chose this-and-future: truncate master, fork a new series at the dragged times. */
  const splitSeriesFromDrag = useCallback(
    async (args: {
      masterId: string;
      recurrenceId: string;
      allDay?: boolean;
      start: Temporal.PlainDateTime;
      end: Temporal.PlainDateTime;
      summary?: string;
      location?: string;
      calendarId?: string;
    }) => {
      if (!operations?.patchEvent || !operations.createEvent) return;
      const { masterKey, original, masterEngine } = resolveRecurrenceMasterRef(
        args.masterId,
        data.events,
        surfaceEvents,
      );
      const allDay = Boolean(args.allDay ?? original?.showWithoutTime ?? masterEngine?.data.allDay);
      const startDate = args.start.toPlainDate().toString();
      const formEnd = allDay ? args.end.subtract({ days: 1 }) : args.end;
      const engineForm = masterEngine ? engineEventToForm(masterEngine) : null;
      const seriesRules = original?.recurrenceRules?.length
        ? original.recurrenceRules
        : engineForm
          ? seriesRecurrenceRulesForSplit(undefined, engineForm)
          : null;
      const form: CalendarEventFormValue = {
        title: args.summary?.trim() || original?.title || engineForm?.title || "",
        calendarId:
          args.calendarId ||
          Object.keys(original?.calendarIds ?? {})[0] ||
          engineForm?.calendarId ||
          defaultCalendarId ||
          "",
        allDay,
        startDate,
        startTime: args.start.toPlainTime().toString({ smallestUnit: "minute" }),
        endDate: formEnd.toPlainDate().toString(),
        endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
        timeZone: normalizeEventTimeZone(
          typeof original?.timeZone === "string"
            ? original.timeZone
            : (engineForm?.timeZone ?? null),
        ),
        location: args.location ?? engineForm?.location ?? "",
        description:
          typeof original?.description === "string"
            ? original.description
            : (engineForm?.description ?? ""),
        freeBusyStatus: original
          ? freeBusyStatusFromWire(original.freeBusyStatus)
          : (engineForm?.freeBusyStatus ?? "busy"),
        alerts: original ? alertsFromWire(original.alerts) : (engineForm?.alerts ?? []),
        attendees: engineForm?.attendees ?? [],
        recurrencePreset: seriesRules?.length ? "custom" : (engineForm?.recurrencePreset ?? "none"),
        recurrenceEnds: engineForm?.recurrenceEnds ?? "never",
        recurrenceUntilDate: engineForm?.recurrenceUntilDate ?? startDate,
        recurrenceCount: engineForm?.recurrenceCount ?? 10,
        ...(seriesRules?.length ? { customRecurrenceRules: seriesRules } : {}),
      };
      try {
        const targetId = (await resolveEventId?.(masterKey)) ?? masterKey;
        const seriesOverrides = resolveSeriesRecurrenceOverrides(
          original,
          masterKey,
          surfaceEvents,
        );
        await operations.patchEvent(
          targetId,
          truncateMasterSeriesPatch(
            seriesRules,
            args.recurrenceId,
            allDay,
            original?.start,
            seriesOverrides,
          ),
        );
        await operations.createEvent(
          forkSeriesDraftWithSplitOverrides(
            form,
            seriesRules,
            original,
            args.recurrenceId,
            seriesOverrides,
          ),
        );
        show(L.toastEventUpdated);
        onMutated?.();
      } catch {
        showError(L.toastEventSaveFailed);
      }
    },
    [
      operations,
      data.events,
      surfaceEvents,
      resolveEventId,
      defaultCalendarId,
      show,
      showError,
      onMutated,
      L.toastEventUpdated,
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
    presentation,
    setPresentation,
    anchor,
    setAnchor,
    dateRange,
    title: rangeTitle(view, anchor, locale),
    compactTitle:
      view === "day" || view === "week" ? rangeTitle(view, anchor, locale, "compact") : undefined,
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
    splitSeriesFromDrag,
  };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
