import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { useAppToast } from "@/hooks/use-app-toast";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";
import type {
  CalendarAPIOperations,
  CalendarFeedInfo,
  CalendarInfo,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/lib/models/calendar-types";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  isViewShowingToday,
  rangeToPlainDateTimeStrings,
  shiftAnchor,
  todayISODate,
  viewDateRange,
} from "@/calendar-core/src/calendar-event-model";
import {
  calendarRouteKey,
  DEFAULT_CALENDAR_PRESENTATION,
  DEFAULT_CALENDAR_VIEW,
  normalizeCalendarSearchQuery,
  type CalendarRouteState,
} from "@/calendar-core/src/calendar-route-search";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import {
  calendarEventToForm,
  createIntentToForm,
  emptyCalendarEventForm,
  engineEventToForm,
  formToCreateIntent,
  draftFromForm,
  formToFullPatch,
  formToPatch,
  sessionOrganizer,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import { meetingUrlFromLinks } from "@/lib/meetings/calendar-meet-link";
import {
  canChangeCalendarOwner,
  canOpenCalendarSettings,
  canRenameCalendar,
  canWriteCalendarCollection,
  pickDefaultCalendarId,
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
import { promptRecurrenceScope } from "@/calendar-core/src/calendar-recurrence-scope-prompt";
import {
  eventIsRecurringSeries,
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
import {
  resolveCalendarEventPreview,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import {
  dismissSidebarOverlay,
  isSidebarOverlayViewport,
} from "@/workspace-shell/src/sidebar-breakpoint";
import { persistCalendarRoutePrefs } from "@/calendar-core/src/calendar-view-prefs";
import { useCalendarDisplayPrefs } from "@/calendar-core/src/use-calendar-display-prefs";
import { calendarViewRangeTitle } from "@/calendar-core/src/calendar-range-title";
import { useCalendarHiddenIds } from "@/calendar-core/src/use-calendar-hidden-ids";
import { withIds } from "@/sidebar-section/src/section-toggle-all";
import { useCalendarSearch } from "@/calendar-core/src/use-calendar-search";
import type { CalendarAutosaveWrites } from "@/calendar-core/src/calendar-autosave-writes";
import { useCalendarEventDeletes } from "@/calendar-core/src/use-calendar-event-deletes";
import { useCalendarEventMoves } from "@/calendar-core/src/use-calendar-event-moves";
import {
  calendarEventWrite,
  editPatchRevert,
  MOVE_STEPS,
  occurrenceOverridesRevert,
  revertCreate,
  revertEventMove,
  revertSeriesSplit,
  SPLIT_STEPS,
  type CalendarEventMutation,
} from "@/calendar-core/src/calendar-undo-writes";

/** How the create editor was opened — workspace routes pointer → popover, menu → dialog. */
export type CalendarCreateSource = "pointer" | "menu";

/** `keepOpen`: an autosave (list mode's pane): no toast, the editor stays. `target`: the
 * editor to save when it is no longer the open one (a flush on switching events). */
export type CalendarEditorSaveOptions = {
  keepOpen?: boolean;
  target?: CalendarEditorState;
  /** List mode's autosave: its writes go in order, each diffed against the last. */
  writes?: CalendarAutosaveWrites;
};

export type CalendarEditorState =
  | {
      mode: "create";
      form: CalendarEventFormValue;
      source: CalendarCreateSource;
      /** Viewport rect for pointer-create popover placement. */
      origin?: CalendarEventSelectionOrigin;
    }
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
  /** Hydrate from `?q=` — App-owned URL, not written here. */
  initialSearchQuery?: string;
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

export function useCalendarController({
  data,
  labels,
  operations,
  initialView,
  initialPresentation = DEFAULT_CALENDAR_PRESENTATION,
  initialAnchor,
  initialSearchQuery,
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
  const organizer = useMemo(
    () => sessionOrganizer(sessionEmail, sessionName),
    [sessionEmail, sessionName],
  );
  const { locale, timeZone, weekStart, visibleHours, visibleHoursStart } =
    useCalendarDisplayPrefs();
  const [view, setView] = useState<CalendarViewId>(initialView ?? DEFAULT_CALENDAR_VIEW);
  const [presentation, setPresentationState] = useState<CalendarPresentation>(initialPresentation);
  const [anchor, setAnchorState] = useState<string>(initialAnchor ?? todayISODate(timeZone));
  const viewRef = useRef(view);
  viewRef.current = view;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const pendingRouteKeyRef = useRef<string | null>(null);
  const searchQueryRef = useRef(normalizeCalendarSearchQuery(initialSearchQuery));
  const applyQueryFromRouteRef = useRef<(query: string) => void>(() => {});
  const lastInitialRouteKeyRef = useRef(
    calendarRouteKey({
      view: initialView ?? DEFAULT_CALENDAR_VIEW,
      date: initialAnchor ?? todayISODate(timeZone),
      presentation: initialPresentation,
      searchQuery: searchQueryRef.current,
    }),
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarOverlayViewport());
  const [calendars, setCalendars] = useState<CalendarInfo[]>(() =>
    sortCalendarsForSidebar(data.calendars),
  );
  const { hiddenCalendarIds, setHiddenCalendarIds } = useCalendarHiddenIds(data.calendars);
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
      searchQuery: searchQueryRef.current,
    };
  }, []);

  const readBrowse = useCallback((): CalendarRouteState => {
    return { ...currentRouteState(), searchQuery: "" };
  }, [currentRouteState]);

  const onRouteStateChangeRef = useRef(onRouteStateChange);
  onRouteStateChangeRef.current = onRouteStateChange;

  const emitRouteState = useCallback((next: CalendarRouteState, replace = false) => {
    pendingRouteKeyRef.current = calendarRouteKey(next);
    onRouteStateChangeRef.current?.(next, { replace });
  }, []);

  useEffect(() => {
    const incoming: CalendarRouteState = {
      view: initialView ?? DEFAULT_CALENDAR_VIEW,
      date: initialAnchor ?? todayISODate(timeZone),
      presentation: initialPresentation,
      searchQuery: normalizeCalendarSearchQuery(initialSearchQuery),
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
    searchQueryRef.current = incoming.searchQuery;
    setView(incoming.view);
    setPresentationState(incoming.presentation);
    setAnchorState(incoming.date);
    applyQueryFromRouteRef.current?.(incoming.searchQuery);
  }, [initialView, initialPresentation, initialAnchor, initialSearchQuery]);

  const selectView = useCallback(
    (next: CalendarViewId) => {
      if (viewRef.current === next) return;
      viewRef.current = next;
      persistCalendarRoutePrefs(next, presentationRef.current);
      setView(next);
      dismissSidebarOverlay(() => setSidebarOpen(false));
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
    const next = todayISODate(timeZone);
    if (anchorRef.current === next) return;
    anchorRef.current = next;
    setAnchorState(next);
    emitRouteState(currentRouteState());
  }, [emitRouteState, currentRouteState, timeZone]);

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

  /** Shows or hides several calendars at once (My calendars' show/hide-all dot). */
  const setCalendarsVisible = useCallback((calendarIds: readonly string[], visible: boolean) => {
    setHiddenCalendarIds((current) => withIds(current, calendarIds, !visible));
  }, []);

  const toggleCalendarVisibility = useCallback((calendarId: string) => {
    setHiddenCalendarIds((current) => withIds(current, [calendarId], !current.has(calendarId)));
  }, []);

  const visibleCalendarIds = useMemo(
    () => new Set(calendars.filter((c) => !hiddenCalendarIds.has(c.id)).map((c) => c.id)),
    [calendars, hiddenCalendarIds],
  );

  const dateRange = useMemo(
    () => viewDateRange(view, anchor, weekStart),
    [view, anchor, weekStart],
  );
  const visibleSearchRange = useMemo(() => rangeToPlainDateTimeStrings(dateRange), [dateRange]);

  const restoreBrowse = useCallback(
    (next: CalendarRouteState, options?: { replace?: boolean }) => {
      viewRef.current = next.view;
      presentationRef.current = next.presentation;
      anchorRef.current = next.date;
      searchQueryRef.current = normalizeCalendarSearchQuery(next.searchQuery);
      persistCalendarRoutePrefs(next.view, next.presentation);
      setView(next.view);
      setPresentationState(next.presentation);
      setAnchorState(next.date);
      emitRouteState({ ...next, searchQuery: searchQueryRef.current }, options?.replace === true);
    },
    [emitRouteState],
  );

  const {
    searchQuery,
    setSearchQuery,
    applyQueryFromRoute,
    searchActive,
    searchResults,
    searchRange,
  } = useCalendarSearch({
    events: data.events,
    calendars,
    visibleCalendarIds,
    visibleRange: visibleSearchRange,
    readBrowse,
    restoreBrowse,
    initialQuery: searchQueryRef.current,
    onQueryCommit: (query) => {
      searchQueryRef.current = query;
      emitRouteState(currentRouteState(), true);
    },
  });
  applyQueryFromRouteRef.current = applyQueryFromRoute;

  const showingToday = useMemo(
    () => isViewShowingToday(view, anchor, todayISODate(timeZone), weekStart),
    [view, anchor, weekStart, timeZone],
  );

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
  /** The repeat scope an autosave chose for an occurrence, so it is asked once. */
  const autosaveScopeRef = useRef<{ key: string; scope: RecurrenceEditScope } | null>(null);

  const openCreateEvent = useCallback(
    (dateISO?: string, startTime?: string) => {
      const calendarId = writableCalendarId(calendars, defaultCalendarId);
      if (!calendarId) return;
      ensureCalendarVisible(calendarId);
      setHeldCreateIntent(null);
      setEditor({
        mode: "create",
        source: "menu",
        form: emptyCalendarEventForm(calendarId, dateISO ?? anchor, startTime, timeZone),
      });
    },
    [calendars, defaultCalendarId, anchor, ensureCalendarVisible, timeZone],
  );

  /** Drag/click create from the Lit surface — popover UI; nothing persisted yet. */
  const openCreateFromSurface = useCallback(
    (intent: CalendarSurfaceCreateIntent) => {
      // Sidebar create-target owns assignment; do not trust a stale Lit intent
      // calendarId (EventsAPI historically fell back to isDefault).
      const calendarId = writableCalendarId(calendars, defaultCalendarId);
      if (!calendarId) return;
      const calendar = calendars.find((entry) => entry.id === calendarId);
      if (!canWriteCalendarCollection(calendar)) return;
      ensureCalendarVisible(calendarId);
      setHeldCreateIntent(null);
      setEditor({
        mode: "create",
        source: "pointer",
        form: createIntentToForm(calendarId, intent, timeZone),
        ...(intent.origin ? { origin: intent.origin } : {}),
      });
    },
    [calendars, defaultCalendarId, ensureCalendarVisible, timeZone],
  );

  const askRecurrenceScope = useCallback(
    (request: RecurrenceScopeRequest) =>
      promptRecurrenceScope(request, pendingScopeResolveRef, setRecurrenceScopeDialog),
    [],
  );

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
    (args: CalendarEventMutation, keepOpen = false) => {
      if (!operations) return;
      // An autosave leaves the editor open and writes without a toast.
      if (!keepOpen) setEditor(null);
      setEditorBusy(false);
      queueMutation(
        calendarEventWrite(
          { ...args, ...(keepOpen ? { silent: true } : {}) },
          { onMutated, undoToastMessage: L.toastEventSaveUndone },
        ),
      );
    },
    [operations, queueMutation, onMutated, L.toastEventSaveUndone],
  );

  const saveEditor = useCallback(
    (chosenScope?: RecurrenceEditScope, options: CalendarEditorSaveOptions = {}) => {
      const target = options.target ?? editor;
      if (!target || !operations) return;
      if (target.mode === "create") {
        ensureCalendarVisible(target.form.calendarId);
        let createdId: string | undefined;
        setHeldCreateIntent(formToCreateIntent(target.form));
        runEditorMutation({
          key: `calendar:create-event:${target.form.calendarId}`,
          successToast: L.toastEventCreated,
          mutation: async () => {
            const created = await operations.createEvent(draftFromForm(target.form, organizer));
            createdId = created.id;
          },
          revert: () => revertCreate(operations, setPendingDeletedEventIds, createdId),
          rollback: () => setHeldCreateIntent(null),
        });
        return;
      }

      void (async () => {
        const loaded = data.events.find((entry) => entry.id === target.eventId);
        const original = options.writes?.base(target.eventId, loaded) ?? loaded;
        const patch = original ? formToPatch(target.form, original) : formToFullPatch(target.form);
        if (patch.attendees && organizer) {
          patch.organizer = organizer;
        }
        const isRecurring = original
          ? eventIsRecurringSeries(original)
          : Boolean(target.recurrenceId);

        const keepOpen = Boolean(options.keepOpen);
        const writeInOrder = <P extends object>(
          build: (base: JmapCalendarEvent | undefined) => P | null,
          write: (written: P) => Promise<unknown>,
        ): Promise<unknown> => {
          if (options.writes) return options.writes.run(target.eventId, loaded, build, write);
          const written = build(original);
          return written ? write(written) : Promise.resolve();
        };
        const occurrenceKey = `${target.eventId}:${target.recurrenceId ?? ""}`;
        // An autosave asks once per occurrence, not on every pause in the typing.
        const rememberedScope =
          keepOpen && autosaveScopeRef.current?.key === occurrenceKey
            ? autosaveScopeRef.current.scope
            : undefined;
        let recurrenceScope: RecurrenceEditScope | undefined;
        if (isRecurring && target.recurrenceId) {
          if (occurrenceHasThisInstanceOverride(original, target.recurrenceId)) {
            recurrenceScope = "thisInstance";
          } else if (chosenScope === "thisInstance" || chosenScope === "thisAndFuture") {
            recurrenceScope = chosenScope;
          } else if (rememberedScope) {
            recurrenceScope = rememberedScope;
          } else {
            const asked = await askRecurrenceScope({
              action: "edit",
              masterId: target.eventId,
              recurrenceId: target.recurrenceId,
            });
            if (asked !== "thisInstance" && asked !== "thisAndFuture") return;
            recurrenceScope = asked;
          }
          if (keepOpen) autosaveScopeRef.current = { key: occurrenceKey, scope: recurrenceScope };
        }

        // Only-this-instance: persist a JSCalendar recurrenceOverrides patch on the master.
        if (recurrenceScope === "thisInstance" && target.recurrenceId) {
          if (!original) {
            showError(L.toastEventSaveFailed);
            return;
          }
          const overrides = occurrenceRecurrenceOverrides(
            target.form,
            original,
            target.recurrenceId,
          );
          if (!overrides) {
            if (!keepOpen) setEditor(null);
            return;
          }
          ensureCalendarVisible(target.form.calendarId);
          let targetId = target.eventId;
          runEditorMutation(
            {
              key: `calendar:update-occurrence:${target.eventId}:${target.recurrenceId}`,
              successToast: L.toastEventUpdated,
              mutation: async () => {
                targetId = (await resolveEventId?.(target.eventId)) ?? target.eventId;
                await writeInOrder(
                  (base) => {
                    const next = base
                      ? occurrenceRecurrenceOverrides(
                          target.form,
                          base,
                          target.recurrenceId as string,
                        )
                      : overrides;
                    return next ? { recurrenceOverrides: next } : null;
                  },
                  (written) => operations.patchEvent(targetId, written),
                );
              },
              revert: async () => {
                await operations.patchEvent(
                  targetId,
                  occurrenceOverridesRevert(original, overrides),
                );
              },
            },
            keepOpen,
          );
          return;
        }

        // This-and-future: truncate the master series, then create a forked series.
        if (recurrenceScope === "thisAndFuture" && target.recurrenceId) {
          ensureCalendarVisible(target.form.calendarId);
          const masterEngine = surfaceEvents?.get(target.eventId);
          // Prefer wire → surface master (true series rule) → occurrence form preset.
          const seriesRules = original?.recurrenceRules?.length
            ? original.recurrenceRules
            : masterEngine
              ? seriesRecurrenceRulesForSplit(undefined, engineEventToForm(masterEngine))
              : seriesRecurrenceRulesForSplit(undefined, target.form);
          let targetId = target.eventId;
          let forkedId: string | undefined;
          // Adapter rows are fresher than bootstrap after only-this — partition from those.
          const seriesOverrides = resolveSeriesRecurrenceOverrides(
            original,
            target.eventId,
            surfaceEvents,
          );
          const truncatePatch = truncateMasterSeriesPatch(
            seriesRules,
            target.recurrenceId,
            Boolean(original?.showWithoutTime ?? target.form.allDay),
            original?.start,
            seriesOverrides,
          );
          const recurrenceId = target.recurrenceId;
          runEditorMutation({
            key: `calendar:split-series:${target.eventId}:${recurrenceId}`,
            successToast: L.toastEventUpdated,
            mutation: async (markCompleted) => {
              targetId = original
                ? target.eventId
                : ((await resolveEventId?.(target.eventId)) ?? target.eventId);
              await operations.patchEvent(targetId, truncatePatch);
              markCompleted(SPLIT_STEPS.truncate);
              const forked = await operations.createEvent(
                forkSeriesDraftWithSplitOverrides(
                  target.form,
                  seriesRules,
                  original,
                  recurrenceId,
                  seriesOverrides,
                ),
              );
              forkedId = forked.id;
              markCompleted(SPLIT_STEPS.fork);
            },
            revert: (completed) =>
              revertSeriesSplit(operations, completed, {
                masterId: targetId,
                forkedId,
                truncatePatch,
                seriesRules,
                seriesOverrides,
              }),
          });
          return;
        }

        if (Object.keys(patch).length === 0) {
          if (!keepOpen) setEditor(null);
          return;
        }
        ensureCalendarVisible(target.form.calendarId);
        let targetId = target.eventId;
        let movedToId: string | undefined;
        runEditorMutation(
          {
            key: `calendar:update-event:${target.eventId}`,
            successToast: L.toastEventUpdated,
            mutation: async (markCompleted) => {
              targetId = original
                ? target.eventId
                : ((await resolveEventId?.(target.eventId)) ?? target.eventId);
              if (patch.calendarId) {
                const created = await operations.createEvent(draftFromForm(target.form, organizer));
                movedToId = created.id;
                markCompleted(MOVE_STEPS.create);
                await operations.deleteEvent(targetId);
                markCompleted(MOVE_STEPS.delete);
                return;
              }
              await writeInOrder(
                (base) => {
                  if (!base) return patch;
                  const next = formToPatch(target.form, base);
                  if (next.attendees && organizer) next.organizer = organizer;
                  return Object.keys(next).length > 0 ? next : null;
                },
                (written) => operations.patchEvent(targetId, written),
              );
            },
            revert: async (completed) => {
              if (patch.calendarId) {
                const originalDraft = original
                  ? draftFromForm(calendarEventToForm(original), organizer)
                  : undefined;
                await revertEventMove(operations, completed, { movedToId, originalDraft });
              } else if (original) {
                await operations.patchEvent(targetId, editPatchRevert(patch, original));
              }
            },
            // A move to another calendar makes a new event: the editor closes.
          },
          keepOpen && !patch.calendarId,
        );
      })();
    },
    [
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
      organizer,
    ],
  );

  const { deleteCalendarEvent, deleteCalendarEvents } = useCalendarEventDeletes({
    L,
    operations,
    events: data.events,
    surfaceEvents,
    queueMutation,
    resolveEventId,
    onMutated,
    askRecurrenceScope,
    setPendingDeletedEventIds,
    setEditor,
    setEditorBusy,
  });
  const moveCalendarEvents = useCalendarEventMoves({
    L,
    operations,
    events: data.events,
    organizer,
    queueMutation,
    ensureCalendarVisible,
    onMutated,
  });

  const deleteEditorEvent = useCallback(() => {
    if (!editor || editor.mode !== "edit") return;
    deleteCalendarEvent({
      eventId: editor.eventId,
      recurrenceId: editor.recurrenceId,
      form: editor.form,
    });
  }, [deleteCalendarEvent, editor]);

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
        canChangeOwner: canChangeCalendarOwner(calendar),
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
          const nextGroupSlug = input.groupSlug?.trim() || null;
          const currentGroupSlug = calendarDialog.groupSlug?.trim() || null;
          const ownerChanged =
            calendarDialog.canChangeOwner &&
            input.groupSlug !== undefined &&
            nextGroupSlug !== currentGroupSlug;
          const updated = await operations.patchCalendar(calendarDialog.calendarId, {
            ...(calendarDialog.nameReadOnly ? {} : { name }),
            color,
            ...(ownerChanged ? { groupSlug: nextGroupSlug } : {}),
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
          return next;
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
    (enabled: boolean, mode?: "full" | "busy") => {
      if (calendarDialog?.mode !== "edit" || !calendarDialog.canPublish) return;
      const calendarId = calendarDialog.calendarId;
      if (enabled) {
        if (!operations?.publishCalendarFeed) return;
        setPublishBusy(true);
        void operations
          .publishCalendarFeed(calendarId, mode)
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
        meetingUrl: meetingUrlFromLinks(original?.links) || engineForm?.meetingUrl || "",
        ...(seriesRules?.length ? { customRecurrenceRules: seriesRules } : {}),
      };
      const seriesOverrides = resolveSeriesRecurrenceOverrides(original, masterKey, surfaceEvents);
      const truncatePatch = truncateMasterSeriesPatch(
        seriesRules,
        args.recurrenceId,
        allDay,
        original?.start,
        seriesOverrides,
      );
      let targetId = masterKey;
      let forkedId: string | undefined;
      const mutation: CalendarEventMutation = {
        key: `calendar:split-drag:${masterKey}:${args.recurrenceId}`,
        successToast: L.toastEventUpdated,
        mutation: async (markCompleted) => {
          targetId = (await resolveEventId?.(masterKey)) ?? masterKey;
          await operations.patchEvent(targetId, truncatePatch);
          markCompleted(SPLIT_STEPS.truncate);
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
          markCompleted(SPLIT_STEPS.fork);
        },
        revert: (completed) =>
          revertSeriesSplit(operations, completed, {
            masterId: targetId,
            forkedId,
            truncatePatch,
            seriesRules,
            seriesOverrides,
          }),
      };
      queueMutation(
        calendarEventWrite(mutation, { onMutated, undoToastMessage: L.toastEventSaveUndone }),
      );
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
    deleteCalendarEvent,
    deleteCalendarEvents,
    moveCalendarEvents,
    L,
    locale,
    surfaceDisplay: { locale, timezone: timeZone, weekStart, visibleHours, visibleHoursStart },
    view,
    selectView,
    presentation,
    setPresentation,
    anchor,
    setAnchor,
    dateRange,
    title: calendarViewRangeTitle(view, anchor, locale, "full", weekStart),
    compactTitle:
      view === "day" || view === "week"
        ? calendarViewRangeTitle(view, anchor, locale, "compact", weekStart)
        : undefined,
    showingToday,
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
    setCalendarsVisible,
    ensureCalendarVisible,
    selectDefaultCalendar,
    visibleCalendarIds,
    searchQuery,
    setSearchQuery,
    searchActive,
    searchResults,
    searchRange,
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
