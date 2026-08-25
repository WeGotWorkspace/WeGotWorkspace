import { useCallback, useEffect, useMemo, useRef, useState, createElement } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Check, Trash2 } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type {
  CalendarAPIOperations,
  CalendarEventDraft,
  CalendarFeedInfo,
  CalendarInfo,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import {
  isViewShowingToday,
  shiftAnchor,
  todayISODate,
  viewDateRange,
} from "@/calendar-core/src/calendar-event-model";
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
  calendarEventToForm,
  createIntentToForm,
  emptyCalendarEventForm,
  engineEventToForm,
  formToCreateIntent,
  formToDraft,
  formToFullPatch,
  formToPatch,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import {
  canOpenCalendarSettings,
  canRenameCalendar,
  canWriteCalendarCollection,
} from "@/calendar-core/src/calendar-collection-write";
import { isSharedWithMeCalendar } from "@/calendar-core/src/calendar-share";
import { resolvePendingCreateIntent } from "@/calendar-core/src/calendar-pending-create";
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
import { useCalendarIcsImport } from "@/calendar-core/src/use-calendar-ics-import";
import { sortCalendarsForSidebar } from "@/calendar-core/src/calendar-sidebar-order";
import {
  canPublishCalendar,
  isSubscribedCalendar,
  writableCalendarId,
} from "@/calendar-core/src/calendar-subscription";
import { copyShareText } from "@/share-ui/share-path-utils";
import type { CalendarRecurrenceScopeDialogState } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import {
  eventIsRecurringSeries,
  exclusionRecurrenceOverrides,
  forkSeriesDraftWithSplitOverrides,
  occurrenceHasThisInstanceOverride,
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
import {
  persistCalendarRoutePrefs,
  persistHiddenCalendarIds,
  readCalendarViewPrefs,
  resolveHiddenCalendarIds,
} from "@/calendar-core/src/calendar-view-prefs";

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

function applyHiddenCalendarIds(
  current: ReadonlySet<string>,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
  persistHiddenCalendarIds(next);
  return next;
}

function pickDefaultCalendarId(calendars: CalendarInfo[], preferred?: string): string | undefined {
  const writable = calendars.filter((c) => canWriteCalendarCollection(c));
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
    () =>
      new Set(resolveHiddenCalendarIds(data.calendars, readCalendarViewPrefs()?.hiddenCalendarIds)),
  );
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | undefined>(() =>
    pickDefaultCalendarId(data.calendars),
  );
  const [pendingDeletedEventIds, setPendingDeletedEventIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [calendarDialog, setCalendarDialog] = useState<CalendarCalendarDialogState>(null);
  const [calendarDialogBusy, setCalendarDialogBusy] = useState(false);
  const [publishFeed, setPublishFeed] = useState<CalendarFeedInfo | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [recurrenceScopeDialog, setRecurrenceScopeDialog] =
    useState<CalendarRecurrenceScopeDialogState>(null);
  const pendingScopeResolveRef = useRef<((scope: RecurrenceScopeChoice | null) => void) | null>(
    null,
  );

  useEffect(() => {
    const next = sortCalendarsForSidebar(data.calendars);
    const nextIds = new Set(next.map((calendar) => calendar.id));
    setCalendars(next);
    setSelectedCalendarId((current) => pickDefaultCalendarId(next, current));
    setHiddenCalendarIds((current) =>
      applyHiddenCalendarIds(current, new Set([...current].filter((id) => nextIds.has(id)))),
    );
    setCalendarDialog((current) => {
      if (current?.mode === "edit" && !nextIds.has(current.calendarId)) return null;
      return current;
    });
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
    persistCalendarRoutePrefs(incoming.view, incoming.presentation);
    setView(incoming.view);
    setPresentationState(incoming.presentation);
    setAnchorState(incoming.date);
  }, [initialView, initialPresentation, initialAnchor]);

  const selectView = useCallback(
    (next: CalendarViewId) => {
      if (viewRef.current === next) return;
      viewRef.current = next;
      persistCalendarRoutePrefs(next, presentationRef.current);
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
      persistCalendarRoutePrefs(viewRef.current, next);
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
      return applyHiddenCalendarIds(current, next);
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
      return applyHiddenCalendarIds(current, next);
    });
  }, []);

  const visibleCalendarIds = useMemo(
    () => new Set(calendars.filter((c) => !hiddenCalendarIds.has(c.id)).map((c) => c.id)),
    [calendars, hiddenCalendarIds],
  );

  const dateRange = useMemo(() => viewDateRange(view, anchor), [view, anchor]);
  const showingToday = useMemo(() => isViewShowingToday(view, anchor), [view, anchor]);

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
  /** Create slot kept after save until a matching occurrence is on the surface. */
  const [heldCreateIntent, setHeldCreateIntent] = useState<CalendarSurfaceCreateIntent | null>(
    null,
  );
  const [editorBusy, setEditorBusy] = useState(false);

  const openCreateEvent = useCallback(
    (dateISO?: string, startTime?: string) => {
      const calendarId = writableCalendarId(calendars, defaultCalendarId);
      if (!calendarId) return;
      ensureCalendarVisible(calendarId);
      setHeldCreateIntent(null);
      setEditor({
        mode: "create",
        form: emptyCalendarEventForm(calendarId, dateISO ?? anchor, startTime),
      });
    },
    [calendars, defaultCalendarId, anchor, ensureCalendarVisible],
  );

  /** Drag/click create from the Lit surface — dialog only; nothing persisted yet. */
  const openCreateFromSurface = useCallback(
    (intent: CalendarSurfaceCreateIntent) => {
      const calendarId = writableCalendarId(calendars, intent.calendarId || defaultCalendarId);
      if (!calendarId) return;
      const calendar = calendars.find((entry) => entry.id === calendarId);
      if (!canWriteCalendarCollection(calendar)) return;
      ensureCalendarVisible(calendarId);
      setHeldCreateIntent(null);
      setEditor({
        mode: "create",
        form: createIntentToForm(calendarId, intent),
      });
    },
    [calendars, defaultCalendarId, ensureCalendarVisible],
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
      const calendar = calendars.find((entry) => entry.id === preview.form.calendarId);
      if (calendar && calendar.mayWrite === false) return;

      // Open the editor immediately — recurrence scope is chosen on Save / Delete.
      setHeldCreateIntent(null);
      setEditor({
        mode: "edit",
        eventId: preview.eventId,
        form: preview.form,
        ...(preview.recurrenceId ? { recurrenceId: preview.recurrenceId } : {}),
      });
    },
    [calendars, data.events, surfaceEvents, pendingDeletedEventIds],
  );

  const closeEditor = useCallback(() => {
    if (!editorBusy) setEditor(null);
  }, [editorBusy]);

  const setEditorForm = useCallback((form: CalendarEventFormValue) => {
    setEditor((current) => (current ? { ...current, form } : current));
  }, []);

  const runEditorMutation = useCallback(
    (args: {
      key: string;
      mutation: () => Promise<void>;
      successToast: string;
      undo: () => void;
    }) => {
      if (!operations) return;
      setEditor(null);
      setEditorBusy(false);
      queueMutation({
        key: args.key,
        toastMessage: args.successToast,
        icon: createElement(Check, { className: "size-4" }),
        executeImmediately: true,
        execute: async () => {
          await args.mutation();
          onMutated?.();
        },
        undo: () => {
          args.undo();
          onMutated?.();
        },
        undoToastMessage: L.toastEventSaveUndone,
      });
    },
    [operations, queueMutation, onMutated, L.toastEventSaveUndone],
  );

  const saveEditor = useCallback(() => {
    if (!editor || !operations) return;
    if (editor.mode === "create") {
      ensureCalendarVisible(editor.form.calendarId);
      let createdId: string | undefined;
      setHeldCreateIntent(formToCreateIntent(editor.form));
      runEditorMutation({
        key: `calendar:create-event:${editor.form.calendarId}`,
        successToast: L.toastEventCreated,
        mutation: async () => {
          const created = await operations.createEvent(
            draftFromForm(
              editor.form,
              sessionEmail ? { email: sessionEmail, name: sessionName || sessionEmail } : undefined,
            ),
          );
          createdId = created.id;
        },
        undo: () => {
          // queueMutation also runs undo on execute failure.
          setHeldCreateIntent(null);
          if (createdId) void operations.deleteEvent(createdId);
        },
      });
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
        if (occurrenceHasThisInstanceOverride(original, editor.recurrenceId)) {
          recurrenceScope = "thisInstance";
        } else {
          const asked = await askRecurrenceScope({
            action: "edit",
            masterId: editor.eventId,
            recurrenceId: editor.recurrenceId,
          });
          if (asked !== "thisInstance" && asked !== "thisAndFuture") return;
          recurrenceScope = asked;
        }
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
        let targetId = editor.eventId;
        runEditorMutation({
          key: `calendar:update-occurrence:${editor.eventId}:${editor.recurrenceId}`,
          successToast: L.toastEventUpdated,
          mutation: async () => {
            targetId = (await resolveEventId?.(editor.eventId)) ?? editor.eventId;
            await operations.patchEvent(targetId, { recurrenceOverrides: overrides });
          },
          undo: () => {
            void operations.patchEvent(targetId, {
              recurrenceOverrides: original.recurrenceOverrides ?? {},
            });
          },
        });
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
        let targetId = editor.eventId;
        let forkedId: string | undefined;
        runEditorMutation({
          key: `calendar:split-series:${editor.eventId}:${editor.recurrenceId}`,
          successToast: L.toastEventUpdated,
          mutation: async () => {
            targetId = original
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
            const forked = await operations.createEvent(
              forkSeriesDraftWithSplitOverrides(
                editor.form,
                seriesRules,
                original,
                editor.recurrenceId!,
                seriesOverrides,
              ),
            );
            forkedId = forked.id;
          },
          undo: () => {
            if (forkedId) void operations.deleteEvent(forkedId);
            if (original) {
              void operations.patchEvent(targetId, formToFullPatch(calendarEventToForm(original)));
            }
          },
        });
        return;
      }

      if (Object.keys(patch).length === 0) {
        setEditor(null);
        return;
      }
      ensureCalendarVisible(editor.form.calendarId);
      let targetId = editor.eventId;
      let movedToId: string | undefined;
      runEditorMutation({
        key: `calendar:update-event:${editor.eventId}`,
        successToast: L.toastEventUpdated,
        mutation: async () => {
          targetId = original
            ? editor.eventId
            : ((await resolveEventId?.(editor.eventId)) ?? editor.eventId);
          if (patch.calendarId) {
            const created = await operations.createEvent(draftFromForm(editor.form, organizer));
            movedToId = created.id;
            await operations.deleteEvent(targetId);
            return;
          }
          await operations.patchEvent(targetId, patch);
        },
        undo: () => {
          if (movedToId) {
            void operations.deleteEvent(movedToId).then(() => {
              if (original) {
                void operations.createEvent(
                  draftFromForm(calendarEventToForm(original), organizer),
                );
              }
            });
            return;
          }
          if (original) {
            void operations.patchEvent(targetId, formToFullPatch(calendarEventToForm(original)));
          }
        },
      });
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
  const canSubscribeCalendar = Boolean(operations?.subscribeCalendar);
  const handleImportCalendarCreated = useCallback(
    (calendar: CalendarInfo) => {
      setCalendars((prev) => sortCalendarsForSidebar([...prev, calendar]));
      selectDefaultCalendar(calendar.id);
    },
    [selectDefaultCalendar],
  );
  const {
    canImportEvents,
    importFile,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    beginImport,
    closeImportDialog,
    submitImportDialog,
  } = useCalendarIcsImport({
    operations,
    labels: L,
    onCalendarCreated: handleImportCalendarCreated,
    onMutated,
  });
  const openCreateCalendarDialog = useCallback(() => {
    if (!canCreateCalendar) return;
    setPublishFeed(null);
    setCalendarDialog({ mode: "create" });
  }, [canCreateCalendar]);

  const openSubscribeCalendarDialog = useCallback(() => {
    if (!canSubscribeCalendar) return;
    setPublishFeed(null);
    setCalendarDialog({ mode: "subscribe" });
  }, [canSubscribeCalendar]);

  const openEditCalendarDialog = useCallback(
    (calendarId: string) => {
      const calendar = calendars.find((entry) => entry.id === calendarId);
      if (!calendar) return;
      const subscribed = isSubscribedCalendar(calendar);
      const mayEdit = canOpenCalendarSettings(calendar);
      const sharedWithMe = isSharedWithMeCalendar(calendar);
      const mayDelete = subscribed
        ? Boolean(operations?.unsubscribeCalendar)
        : (calendar.mayDelete !== false || sharedWithMe) && Boolean(operations?.deleteCalendar);
      if (!mayEdit && !mayDelete) return;
      const canPublish = canPublishCalendar(calendar) && Boolean(operations?.publishCalendarFeed);
      setPublishFeed(null);
      setCalendarDialog({
        mode: "edit",
        calendarId: calendar.id,
        name: calendar.name,
        color: calendar.color || DEFAULT_CALENDAR_COLOR,
        mayDelete,
        scope: calendar.scope === "group" ? "group" : "personal",
        groupSlug: calendar.groupSlug ?? null,
        subscriptionId: calendar.subscriptionId ?? null,
        sourceUrl: calendar.subscriptionUrl,
        canPublish,
        nameReadOnly: !canRenameCalendar(calendar),
        removeShared: sharedWithMe,
      });
      if (subscribed && calendar.subscriptionId && !calendar.subscriptionUrl) {
        void operations
          ?.getCalendarSubscription?.(calendar.subscriptionId)
          .then((subscription) => {
            setCalendarDialog((current) =>
              current?.mode === "edit" && current.calendarId === calendarId
                ? { ...current, sourceUrl: subscription.url }
                : current,
            );
            setCalendars((prev) =>
              prev.map((entry) =>
                entry.id === calendarId ? { ...entry, subscriptionUrl: subscription.url } : entry,
              ),
            );
          })
          .catch(() => undefined);
      }
      if (canPublish && operations?.getCalendarFeed) {
        setPublishBusy(true);
        void operations
          .getCalendarFeed(calendar.id)
          .then((feed) => {
            setPublishFeed(feed);
          })
          .catch(() => {
            setPublishFeed(null);
          })
          .finally(() => {
            setPublishBusy(false);
          });
      }
    },
    [calendars, operations],
  );

  const closeCalendarDialog = useCallback(() => {
    if (!calendarDialogBusy) setCalendarDialog(null);
  }, [calendarDialogBusy]);

  const upsertCalendar = useCallback((updated: CalendarInfo) => {
    setCalendars((prev) =>
      sortCalendarsForSidebar(
        prev.some((entry) => entry.id === updated.id)
          ? prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry))
          : [...prev, updated],
      ),
    );
  }, []);

  const saveCalendarDialog = useCallback(
    (input: CalendarCalendarDialogConfirmInput) => {
      if (!operations || !calendarDialog) return;
      const name = input.name.trim();
      const color = input.color.trim() || DEFAULT_CALENDAR_COLOR;
      if (calendarDialog.mode !== "subscribe" && !name) return;

      setCalendarDialogBusy(true);
      void (async () => {
        try {
          if (calendarDialog.mode === "subscribe") {
            if (!operations.subscribeCalendar || !input.url?.trim()) return;
            const created = await operations.subscribeCalendar({
              url: input.url.trim(),
              ...(input.nameTouched && name ? { name } : {}),
              color,
              ...(input.groupSlug?.trim() ? { groupSlug: input.groupSlug.trim() } : {}),
            });
            setCalendars((prev) => sortCalendarsForSidebar([...prev, created]));
            selectDefaultCalendar(created.id);
            show(L.toastCalendarSubscribed);
            setCalendarDialog(null);
            onMutated?.();
            return;
          }
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
            ...(calendarDialog.nameReadOnly ? {} : { name }),
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
          showError(
            calendarDialog.mode === "subscribe"
              ? L.toastCalendarSubscribeFailed
              : L.toastCalendarSaveFailed,
          );
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
      L.toastCalendarSubscribed,
      L.toastCalendarSubscribeFailed,
      L.toastCalendarSaveFailed,
    ],
  );

  const deleteCalendarFromDialog = useCallback(() => {
    if (calendarDialog?.mode !== "edit") return;
    const calendarId = calendarDialog.calendarId;
    const subscriptionId = calendarDialog.subscriptionId;
    const unsubscribe = subscriptionId ? operations?.unsubscribeCalendar : undefined;
    const deleteCalendar = operations?.deleteCalendar;
    if (subscriptionId && !unsubscribe) return;
    if (!subscriptionId && !deleteCalendar) return;
    setCalendarDialogBusy(true);
    void (async () => {
      try {
        if (subscriptionId && unsubscribe) {
          await unsubscribe(subscriptionId);
        } else if (deleteCalendar) {
          await deleteCalendar(calendarId);
        }
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
          return applyHiddenCalendarIds(current, next);
        });
        show(
          subscriptionId
            ? L.toastCalendarUnsubscribed
            : calendarDialog.removeShared
              ? L.toastCalendarShareRemoved
              : L.toastCalendarDeleted,
        );
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
    L.toastCalendarUnsubscribed,
    L.toastCalendarShareRemoved,
    L.toastCalendarSaveFailed,
  ]);

  const toggleCalendarPublish = useCallback(
    (enabled: boolean) => {
      if (calendarDialog?.mode !== "edit" || !calendarDialog.canPublish) return;
      const calendarId = calendarDialog.calendarId;
      if (enabled) {
        if (!operations?.publishCalendarFeed) return;
        setPublishBusy(true);
        void operations
          .publishCalendarFeed(calendarId)
          .then((feed) => {
            setPublishFeed(feed);
            show(L.toastFeedPublished);
          })
          .catch(() => {
            showError(L.toastFeedFailed);
          })
          .finally(() => {
            setPublishBusy(false);
          });
        return;
      }
      if (!operations?.unpublishCalendarFeed) return;
      setPublishBusy(true);
      void operations
        .unpublishCalendarFeed(calendarId)
        .then(() => {
          setPublishFeed(null);
          show(L.toastFeedUnpublished);
        })
        .catch(() => {
          showError(L.toastFeedFailed);
        })
        .finally(() => {
          setPublishBusy(false);
        });
    },
    [
      calendarDialog,
      operations,
      show,
      showError,
      L.toastFeedPublished,
      L.toastFeedUnpublished,
      L.toastFeedFailed,
    ],
  );

  const copyCalendarFeedUrl = useCallback(async () => {
    const value = publishFeed?.httpsUrl;
    if (!value) return;
    const copied = await copyShareText(value);
    if (copied) show(L.toastFeedCopied);
  }, [publishFeed, show, L.toastFeedCopied]);

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
      const seriesOverrides = resolveSeriesRecurrenceOverrides(original, masterKey, surfaceEvents);
      let targetId = masterKey;
      let forkedId: string | undefined;
      queueMutation({
        key: `calendar:split-drag:${masterKey}:${args.recurrenceId}`,
        toastMessage: L.toastEventUpdated,
        icon: createElement(Check, { className: "size-4" }),
        executeImmediately: true,
        execute: async () => {
          targetId = (await resolveEventId?.(masterKey)) ?? masterKey;
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
          const forked = await operations.createEvent(
            forkSeriesDraftWithSplitOverrides(
              form,
              seriesRules,
              original,
              args.recurrenceId,
              seriesOverrides,
            ),
          );
          forkedId = forked.id;
          onMutated?.();
        },
        undo: () => {
          if (forkedId) void operations.deleteEvent(forkedId);
          if (original) {
            void operations.patchEvent(targetId, formToFullPatch(calendarEventToForm(original)));
          }
          onMutated?.();
        },
        undoToastMessage: L.toastEventSaveUndone,
      });
    },
    [
      operations,
      data.events,
      surfaceEvents,
      resolveEventId,
      defaultCalendarId,
      queueMutation,
      onMutated,
      L.toastEventUpdated,
      L.toastEventSaveUndone,
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

  const pendingCreateIntent = useMemo(
    () => resolvePendingCreateIntent(editor, heldCreateIntent, surfaceEventsForView),
    [editor, heldCreateIntent, surfaceEventsForView],
  );

  return {
    editor,
    pendingCreateIntent,
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
    showingToday,
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
    canSubscribeCalendar,
    canImportEvents,
    importFile,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    beginImport,
    closeImportDialog,
    submitImportDialog,
    calendarDialog,
    calendarDialogBusy,
    openCreateCalendarDialog,
    openSubscribeCalendarDialog,
    openEditCalendarDialog,
    closeCalendarDialog,
    saveCalendarDialog,
    deleteCalendarFromDialog,
    publishFeed,
    publishBusy,
    toggleCalendarPublish,
    copyCalendarFeedUrl,
    upsertCalendar,
    undoLatest,
    queueMutation,
    surfaceEventsForView,
    pendingDeletedEventIds,
    askRecurrenceScope,
    recurrenceScopeDialog,
    truncateSeriesFromOccurrence,
    splitSeriesFromDrag,
  };
}

export type CalendarController = ReturnType<typeof useCalendarController>;
