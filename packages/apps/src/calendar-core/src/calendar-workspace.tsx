import { CalendarDays, MoreHorizontal, Trash2 } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CalendarNoticeBar } from "@/calendar-core/src/calendar-notice-bar";
import { useTeamAvailability } from "@/calendar-core/src/use-team-availability";
import { useAppToast } from "@/hooks/use-app-toast";
import { CalendarSchedulingGoneError } from "@/lib/api/wgw/calendar-scheduling";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { ActionBar } from "@/action-bar/src/action-bar";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { CollectionState } from "@/collection-state/src/collection-state";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import { CalendarWorkspaceHeader } from "@/calendar-core/src/calendar-workspace-header";
import { CalendarWorkspaceSidebar } from "@/calendar-core/src/calendar-workspace-sidebar";
import { CalendarSearchResultsList } from "@/calendar-core/src/calendar-search-results";
import {
  calendarListRows,
  useCalendarListSelection,
} from "@/calendar-core/src/use-calendar-list-selection";
import { useCalendarListDetail } from "@/calendar-core/src/use-calendar-list-detail";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { CalendarEventList, calendarPeriodDays } from "@/calendar-core/src/calendar-event-list";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import {
  filterInviteeNotifications,
  pendingInvitationCount,
} from "@/calendar-core/src/calendar-invitation-event";
import { CalendarInvitationsPanel } from "@/calendar-core/src/calendar-invitations-panel";
import { CalendarInvitationsTrigger } from "@/calendar-core/src/calendar-invitations-trigger";
import { useCalendarInvitations } from "@/calendar-core/src/use-calendar-invitations";
import { useCalendarContactInvitees } from "@/calendar-core/src/use-calendar-contact-invitees";
import { CalendarCalendarDialog } from "@/calendar-core/src/calendar-calendar-dialog";
import { CalendarImportDialog } from "@/calendar-core/src/calendar-import-dialog";
import { ICS_FILE_ACCEPT, icsFileFromList } from "@/calendar-core/src/calendar-ics-import";
import { CalendarRecurrenceScopeDialog } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import {
  CalendarEventDetailsPopover,
  type CalendarEventDetailsPopoverEditProps,
} from "@/calendar-core/src/calendar-event-details-popover";
import { CalendarEventPane } from "@/calendar-core/src/calendar-event-pane";
import {
  eventPreviewOccurrenceKey,
  formWithEventTimesDraft,
  resolveCalendarEventPreview,
  resolveInvitationEventPreview,
  resolveLiveEventPreview,
  type CalendarEventPreviewModel,
  type CalendarEventSelectionOrigin,
  type CalendarEventTimesDraft,
} from "@/calendar-core/src/calendar-event-preview";
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import {
  CalendarOverlayPopover,
  resolveCalendarOverlayPreview,
  type CalendarOverlayPreview,
} from "@/calendar-core/src/calendar-overlay-preview";
import { partitionCalendarTaskDueSidebarLists } from "@/calendar-core/src/calendar-task-due-sidebar";
import { useCalendarOverlayHiddenIds } from "@/calendar-core/src/use-calendar-overlay-hidden-ids";
import { useCalendarTaskDueOverlay } from "@/calendar-core/src/use-calendar-task-due-overlay";
import { personalOwnerLabel } from "@/calendar-core/src/calendar-workspace-props";
import { useCalendarSharePrincipals } from "@/calendar-core/src/use-calendar-share-principals";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  normalizeParticipationStatus,
  organizerAddress,
  sessionEventInviteeStatus,
  type CalendarAttendee,
} from "@/lib/models/calendar-attendees";
import { occurrenceHasThisInstanceOverride } from "@/calendar-core/src/calendar-recurrence-scope";
import {
  eventIsRecurringForRsvp,
  persistInviteeRsvp,
  rsvpRecurrenceIdForEvent,
  type CalendarRsvpPersistSource,
} from "@/calendar-core/src/calendar-rsvp-scope";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import {
  canManageCalendarSharing,
  canWriteCalendarCollection,
  isCalendarEventFormReadOnly,
} from "@/calendar-core/src/calendar-collection-write";
import type { CalendarShareWith } from "@/calendar-core/src/calendar-share";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { SideDrawer } from "@/ui/side-drawer";
import { DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS } from "@/text-editor-core/docs-collab/docs-collab-card";
import { useDocsCommentsLayout } from "@/text-editor-core/docs-collab/use-docs-comments-layout";
import "./calendar-workspace.css";

export function CalendarWorkspace({
  data,
  session,
  labels,
  operations,
  surface,
  initialView,
  initialPresentation,
  initialAnchor,
  initialSearchQuery,
  onViewChange,
  onRouteStateChange,
  onLogout,
  className,
  pendingEventIds,
  meetOperations,
  workspaceOrigin,
  onJoinMeeting,
  taskDueBootstrap,
  onOpenTaskInTasks,
  availabilitySource,
  availabilityPreset,
}: CalendarWorkspaceProps) {
  const controller = useCalendarController({
    data,
    labels,
    operations,
    initialView,
    initialPresentation,
    initialAnchor,
    initialSearchQuery,
    onViewChange,
    onRouteStateChange, // App-owned URL sync — must reach the controller
    surfaceEvents: surface?.events,
    resolveEventId: surface?.resolveJmapId,
    onMutated: () => {
      surface?.syncNow();
    },
    sessionEmail: organizerAddress(session.user)?.email,
    sessionName: session.user.displayName,
  });
  const { hiddenOverlayTaskListIds, setHiddenOverlayTaskListIds, toggleOverlayTaskListVisibility } =
    useCalendarOverlayHiddenIds();
  const taskDueOverlay = useCalendarTaskDueOverlay({
    preset: taskDueBootstrap ?? null,
    hiddenListIds: hiddenOverlayTaskListIds,
  });
  const { ownedLists: overlayOwnedLists, sharedLists: overlaySharedLists } = useMemo(
    () => partitionCalendarTaskDueSidebarLists(taskDueOverlay.taskLists),
    [taskDueOverlay.taskLists],
  );
  const {
    L,
    locale,
    surfaceDisplay,
    view,
    selectView,
    presentation,
    setPresentation,
    anchor,
    title,
    compactTitle,
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
    setCalendarsVisible,
    selectDefaultCalendar,
    visibleCalendarIds,
    defaultCalendarId,
    litSurface,
    editor,
    pendingCreateIntent,
    editorBusy,
    openCreateEvent,
    openCreateFromSurface,
    openEditEventKey,
    closeEditor,
    pendingDeletedEventIds,
    setEditorForm,
    saveEditor,
    deleteEditorEvent,
    deleteCalendarEvent,
    setAnchor,
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
    surfaceEventsForView,
    askRecurrenceScope,
    recurrenceScopeDialog,
    truncateSeriesFromOccurrence,
    splitSeriesFromDrag,
    searchQuery,
    setSearchQuery,
    searchActive,
    searchResults,
    dateRange,
    undoLatest,
    deleteCalendarEvents,
    moveCalendarEvents,
  } = controller;
  const { showError, showSuccess } = useAppToast();
  const handleInvitationResponded = useCallback(() => {
    surface?.syncNow();
  }, [surface]);
  const handleInvitationError = useCallback(
    (error: unknown) => {
      showError(
        error instanceof CalendarSchedulingGoneError
          ? L.toastInvitationCancelled
          : L.toastRsvpFailed,
      );
    },
    [L.toastInvitationCancelled, L.toastRsvpFailed, showError],
  );
  const handleSchedulingConflict = useCallback(() => {
    showError(L.toastInvitationCancelled);
  }, [L.toastInvitationCancelled, showError]);
  const invitations = useCalendarInvitations(operations, {
    username: session.user.username,
    onResponded: handleInvitationResponded,
    onError: handleInvitationError,
    onSchedulingConflict: handleSchedulingConflict,
  });
  const { cards: contactCards, refreshCards } = useCalendarContactInvitees(session.user.username);
  const inviteeNotifications = useMemo(
    () =>
      filterInviteeNotifications(invitations.notifications, [
        session.user.email ?? "",
        session.user.username ?? "",
      ]),
    [invitations.notifications, session.user.email, session.user.username],
  );
  const invitationsLayout = useDocsCommentsLayout();
  const useInvitationsDrawer = invitationsLayout === "drawer";
  const { directoryGroups, sharePrincipals, searchSharePrincipals, noTeam, attendeePickerNoTeam } =
    useCalendarSharePrincipals({
      data,
      invitees: invitations.invitees,
      username: session.user.username,
      operations,
    });
  const [invitationsOpen, setInvitationsOpen] = useState(false);
  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "calendar-dialog-surface",
  });
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const availability = useTeamAvailability({
    source: availabilitySource,
    preset: availabilityPreset,
    viewer: session.user.username,
    view,
    anchor,
    weekStart: surfaceDisplay.weekStart,
    online,
    busyLabel: L.teamAvailabilityBusy,
  });
  const editCalendar =
    calendarDialog?.mode === "edit"
      ? (calendars.find((calendar) => calendar.id === calendarDialog.calendarId) ?? null)
      : null;
  const patchShareWith = useCallback(
    async (calendarId: string, shareWith: CalendarShareWith) => {
      if (!operations?.patchCalendar) {
        throw new Error(L.shareCalendarFailed);
      }
      try {
        const updated = await operations.patchCalendar(calendarId, { shareWith });
        upsertCalendar(updated);
      } catch (error) {
        showError(L.shareCalendarFailed);
        throw error;
      }
    },
    [L.shareCalendarFailed, operations, showError, upsertCalendar],
  );
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const icsFileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: 0,
    onRequestDeleteSelection: () => {},
    onUndoQueuedAction: undoLatest,
    listNavigationEnabled: false,
  });
  const [eventPreview, setEventPreview] = useState<{
    model: CalendarEventPreviewModel;
    origin?: CalendarEventSelectionOrigin;
    /** When true, the popover hosts the invitee form (RSVP + calendar picker). */
    invitation?: boolean;
    /** When true, the popover hosts the editor form for this selection. */
    interactiveEdit?: boolean;
  } | null>(null);
  const [overlayPreview, setOverlayPreview] = useState<CalendarOverlayPreview | null>(null);
  const [eventTimesDraft, setEventTimesDraft] = useState<CalendarEventTimesDraft | null>(null);
  const liveEventPreview = useMemo(() => {
    if (!eventPreview) return null;
    return resolveLiveEventPreview(eventPreview.model, {
      events: data.events,
      surfaceEvents: surface?.events,
      pendingDeletedEventIds,
      timesDraft: eventTimesDraft,
    });
  }, [data.events, eventPreview, eventTimesDraft, pendingDeletedEventIds, surface?.events]);
  const toggleInvitationsOpen = () => {
    if (!invitationsOpen) {
      void invitations.refreshIfIdle().catch(() => undefined);
    }
    setInvitationsOpen((open) => !open);
  };

  const canWrite = Boolean(operations) && calendars.some((c) => canWriteCalendarCollection(c));
  const sessionEmail = organizerAddress(session.user)?.email;
  const previewCalendar = liveEventPreview
    ? calendars.find((entry) => entry.id === liveEventPreview.form.calendarId)
    : undefined;
  const previewCanEdit =
    Boolean(operations) &&
    !isCalendarEventFormReadOnly({
      mode: "edit",
      calendar: previewCalendar,
      isOrganizer: isSessionEventOrganizer(
        liveEventPreview?.form.attendees ?? [],
        sessionEmail,
        invitations.invitees,
      ),
    });
  const previewCanResize = Boolean(operations) && canWriteCalendarCollection(previewCalendar);
  const ownerLabel = personalOwnerLabel(session);
  const pendingCalendarIds = useMemo(() => {
    const ids = new Set<string>();
    if (!pendingEventIds || pendingEventIds.size === 0) return ids;
    for (const event of data.events) {
      if (!pendingEventIds.has(event.id)) continue;
      const calendarId = Object.keys(event.calendarIds ?? {})[0];
      if (calendarId) ids.add(calendarId);
    }
    return ids;
  }, [data.events, pendingEventIds]);

  useDocumentTitle(title);

  useEffect(() => {
    if (!eventPreview?.interactiveEdit || !editor || editor.mode !== "edit" || !eventTimesDraft) {
      return;
    }
    const key = eventPreviewOccurrenceKey({
      eventId: editor.eventId,
      form: editor.form,
      ...(editor.recurrenceId ? { recurrenceId: editor.recurrenceId } : {}),
    });
    if (eventTimesDraft.key !== key) return;
    const next = formWithEventTimesDraft(editor.form, eventTimesDraft);
    if (
      next.startDate === editor.form.startDate &&
      next.startTime === editor.form.startTime &&
      next.endDate === editor.form.endDate &&
      next.endTime === editor.form.endTime &&
      next.allDay === editor.form.allDay
    ) {
      return;
    }
    setEditorForm(next);
  }, [editor, eventPreview?.interactiveEdit, eventTimesDraft, setEditorForm]);

  const persistRsvp = useCallback(
    (
      id: string,
      status: CalendarSchedulingRespondStatus,
      calendarId: string | undefined,
      persist: {
        source: CalendarRsvpPersistSource;
        editorRecurrenceId?: string;
        attendees?: CalendarAttendee[];
      },
    ) => {
      const notification =
        inviteeNotifications.find((row) => row.id === id) ??
        inviteeNotifications.find((row) => row.eventId === id);
      const eventId =
        notification?.eventId ?? (editor?.mode === "edit" ? editor.eventId : undefined) ?? id;
      const event = data.events.find((entry) => entry.id === eventId);
      const editorRecurrenceId = persist.editorRecurrenceId;
      const recurrenceId = rsvpRecurrenceIdForEvent({
        editorRecurrenceId,
        event,
        notification,
      });
      const attendeesForStatus =
        persist.attendees ?? (editor?.mode === "edit" ? editor.form.attendees : undefined);
      const previousStatus =
        (attendeesForStatus
          ? sessionEventInviteeStatus(
              attendeesForStatus,
              organizerAddress(session.user)?.email,
              invitations.invitees,
            )
          : undefined) ?? notification?.participationStatus;
      const notificationId = notification?.id ?? id;
      const respondOptions = calendarId ? { calendarId } : {};
      return persistInviteeRsvp({
        source: persist.source,
        recurring: eventIsRecurringForRsvp(event, notification?.recurring, editorRecurrenceId),
        previousStatus,
        masterId: eventId,
        recurrenceId,
        askScope: askRecurrenceScope,
        respond: async (scopeOptions) => {
          await invitations.respond(notificationId, status, {
            ...respondOptions,
            ...scopeOptions,
          });
          showSuccess(L.toastRsvpUpdated);
        },
      });
    },
    [
      L.toastRsvpUpdated,
      askRecurrenceScope,
      data.events,
      editor,
      invitations,
      inviteeNotifications,
      session.user,
      showSuccess,
    ],
  );

  const closeEventPreview = useCallback(() => {
    setEventPreview(null);
    setOverlayPreview(null);
    setEventTimesDraft(null);
  }, []);

  const onEventTimesDraft = useCallback((draft: CalendarEventTimesDraft | null) => {
    setEventTimesDraft((current) => {
      if (current == null && draft == null) return current;
      if (
        current &&
        draft &&
        current.key === draft.key &&
        current.allDay === draft.allDay &&
        Temporal.PlainDateTime.compare(current.start, draft.start) === 0 &&
        Temporal.PlainDateTime.compare(current.end, draft.end) === 0
      ) {
        return current;
      }
      return draft;
    });
  }, []);

  const openEventPreview = useCallback(
    (key: string, origin?: CalendarEventSelectionOrigin) => {
      const overlay = resolveCalendarOverlayPreview(key, origin, {
        taskDueMarkers: taskDueOverlay.markers,
        availability,
      });
      if (overlay !== undefined) {
        if (!overlay) return;
        setEventTimesDraft(null);
        closeEditor();
        setEventPreview(null);
        setOverlayPreview(overlay);
        return;
      }
      const model = resolveCalendarEventPreview(key, {
        events: data.events,
        surfaceEvents: surface?.events,
        pendingDeletedEventIds,
      });
      if (!model) return;
      const calendar = calendars.find((entry) => entry.id === model.form.calendarId);
      const sessionIsOrganizer = isSessionEventOrganizer(
        model.form.attendees,
        organizerAddress(session.user)?.email,
        invitations.invitees,
      );
      const canInteractiveEdit =
        Boolean(operations) &&
        !isCalendarEventFormReadOnly({
          mode: "edit",
          calendar,
          isOrganizer: sessionIsOrganizer,
        });
      setEventTimesDraft(null);
      setOverlayPreview(null);
      if (canInteractiveEdit) {
        void openEditEventKey(key);
        setEventPreview({ model, origin, interactiveEdit: true });
        return;
      }
      closeEditor();
      const sessionIsInvitee = isSessionEventInvitee(
        model.form.attendees,
        organizerAddress(session.user)?.email,
        invitations.invitees,
      );
      if (sessionIsInvitee) {
        setEventPreview({ model, origin, invitation: true });
        return;
      }
      setEventPreview({ model, origin });
    },
    [
      availability,
      calendars,
      closeEditor,
      data.events,
      invitations.invitees,
      openEditEventKey,
      operations,
      pendingDeletedEventIds,
      session.user,
      surface?.events,
      taskDueOverlay.markers,
    ],
  );

  const openInvitationPreview = useCallback(
    (key: string, origin?: CalendarEventSelectionOrigin) => {
      closeEditor();
      const notification = inviteeNotifications.find(
        (row) => row.eventId === key || row.id === key,
      );
      let model = notification
        ? resolveInvitationEventPreview(notification, {
            events: data.events,
            surfaceEvents: surface?.events,
            pendingDeletedEventIds,
            untitledLabel: L.untitledEvent,
            defaultCalendarId,
            calendars: data.calendars,
          })
        : resolveCalendarEventPreview(key, {
            events: data.events,
            surfaceEvents: surface?.events,
            pendingDeletedEventIds,
          });
      if (!model) return;
      // Inbox fallback models only carry the organizer — seed the session invitee for RSVP chrome.
      if (notification && sessionEmail) {
        const alreadyInvitee = isSessionEventInvitee(
          model.form.attendees,
          sessionEmail,
          invitations.invitees,
        );
        if (!alreadyInvitee) {
          model = {
            ...model,
            form: {
              ...model.form,
              attendees: [
                ...model.form.attendees,
                {
                  email: sessionEmail,
                  name: session.user.displayName || sessionEmail,
                  participationStatus: normalizeParticipationStatus(
                    notification.participationStatus,
                  ),
                },
              ],
            },
          };
        }
      }
      setEventTimesDraft(null);
      setEventPreview({ model, origin, invitation: true });
    },
    [
      L.untitledEvent,
      closeEditor,
      data.events,
      defaultCalendarId,
      invitations.invitees,
      inviteeNotifications,
      pendingDeletedEventIds,
      session.user.displayName,
      sessionEmail,
      surface?.events,
    ],
  );

  const closeInteractiveEditor = useCallback(() => {
    closeEditor();
    setEventPreview(null);
    setEventTimesDraft(null);
  }, [closeEditor]);

  const pointerCreateOpen = editor?.mode === "create" && editor.source === "pointer";
  const menuCreateOpen = editor?.mode === "create" && editor.source === "menu";
  const pointerCreatePreview: CalendarEventPreviewModel | null = pointerCreateOpen
    ? { eventId: "", form: editor.form }
    : null;
  const detailsPopoverOpen = Boolean((eventPreview && liveEventPreview) || pointerCreatePreview);

  const deleteFromPreview = useCallback(() => {
    if (!liveEventPreview || !previewCanEdit) return;
    const { eventId, recurrenceId, form } = liveEventPreview;
    setEventPreview(null);
    setEventTimesDraft(null);
    closeEditor();
    deleteCalendarEvent({
      eventId,
      form,
      ...(recurrenceId ? { recurrenceId } : {}),
    });
  }, [closeEditor, deleteCalendarEvent, liveEventPreview, previewCanEdit]);

  const invitationsPanel = useMemo(
    () => (
      <CalendarInvitationsPanel
        notifications={inviteeNotifications}
        labels={L}
        locale={locale}
        calendars={calendars}
        defaultCalendarId={defaultCalendarId}
        showCloseButton
        onClose={() => setInvitationsOpen(false)}
        onRespond={async (id, status, calendarId) => {
          await persistRsvp(id, status, calendarId, { source: "sidebar" });
        }}
        onOpenEvent={openInvitationPreview}
      />
    ),
    [
      L,
      calendars,
      defaultCalendarId,
      inviteeNotifications,
      locale,
      openInvitationPreview,
      persistRsvp,
    ],
  );

  // Both calendar sections (mine, shared with me) take the same row props.
  const calendarRowProps = {
    hiddenCalendarIds,
    defaultCalendarId,
    canDeleteCalendars: Boolean(operations?.deleteCalendar),
    canUnsubscribe: Boolean(operations?.unsubscribeCalendar),
    editLabel: L.editCalendar,
    subscribedLabel: L.subscribedCalendarBadge,
    viewOnlyLabel: L.viewOnlyCalendarBadge,
    pendingCalendarIds,
    pendingSyncLabel: L.pendingSync,
    onToggleVisibility: toggleCalendarVisibility,
    onSelectDefault: selectDefaultCalendar,
    onEdit: openEditCalendarDialog,
  };

  /** List mode is a list + detail workspace (as Tasks, Notes, Contacts); the grid keeps the popover. */
  const listLayout = presentation === "list";
  const closeEventDetail = eventPreview?.interactiveEdit
    ? closeInteractiveEditor
    : closeEventPreview;
  /** Search lives in list mode only (the floating bar over the list). */
  const searching = listLayout && searchActive;
  const {
    workspaceRef: listWorkspaceRef,
    detailOverlay,
    goBack,
    leaveForBatchWrite,
    autosave: editorAutosave,
    deleteEditedEvent,
    detailDelete,
  } = useCalendarListDetail({
    L,
    listLayout,
    eventSelected: Boolean(eventPreview),
    interactiveEdit: Boolean(eventPreview?.interactiveEdit),
    recurring: Boolean(liveEventPreview?.recurrenceId),
    deleteFromPreview:
      eventPreview && !eventPreview.invitation && previewCanEdit ? deleteFromPreview : undefined,
    editor,
    saveEditor,
    deleteEditorEvent,
    clearEvent: () => {
      setEventPreview(null);
      setEventTimesDraft(null);
    },
    closeEventDetail,
    requestConfirm,
  });
  /** Wide list mode: the list header has room for the full range title. */
  const wideList = listLayout && !detailOverlay;
  /** The invitations inbox is the grid's: list mode has no trigger and hides the panel
   * (it is back on switching to the grid). */
  const invitationsShown = invitationsOpen && !listLayout;
  const listEvents = surfaceEventsForView ?? surface?.events;
  const periodDays = useMemo(
    () =>
      listLayout
        ? calendarPeriodDays(listEvents, visibleCalendarIds, dateRange, surfaceDisplay.timezone)
        : [],
    [dateRange, listEvents, listLayout, surfaceDisplay.timezone, visibleCalendarIds],
  );
  const activeEventKey = liveEventPreview ? eventPreviewOccurrenceKey(liveEventPreview) : undefined;
  const listRows = useMemo(
    () => calendarListRows(periodDays, searching ? searchResults : null),
    [periodDays, searchResults, searching],
  );
  const listSelection = useCalendarListSelection({
    L,
    rows: listRows,
    resetKey: `${presentation}|${view}|${anchor}|${searching ? searchQuery : ""}`,
    activeKey: activeEventKey ?? "",
    calendars,
    openEvent: openEventPreview,
    requestConfirm,
    leaveEvent: leaveForBatchWrite,
    deleteEvents: deleteCalendarEvents,
    moveEvents: (keys, calendarId) => moveCalendarEvents(keys, calendarId, editor),
  });
  const multiSelected = listLayout && listSelection.multiSelected;

  const sidebarEl = (
    <CalendarWorkspaceSidebar
      L={L}
      open={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      session={session}
      onLogout={onLogout}
      calendars={calendars}
      rowProps={calendarRowProps}
      onSetVisible={setCalendarsVisible}
      canWrite={canWrite}
      onCreateEvent={() => {
        closeEventPreview();
        openCreateEvent();
      }}
      onCreateCalendar={canCreateCalendar ? openCreateCalendarDialog : undefined}
      onSubscribeCalendar={canSubscribeCalendar ? openSubscribeCalendarDialog : undefined}
      onImportEvents={
        canImportEvents
          ? () => {
              closeEventPreview();
              icsFileInputRef.current?.click();
            }
          : undefined
      }
      onToday={goToday}
      availability={availability}
      reminders={{
        lists: overlayOwnedLists,
        sharedLists: overlaySharedLists,
        hiddenListIds: hiddenOverlayTaskListIds,
        onSetHiddenListIds: setHiddenOverlayTaskListIds,
        onToggleVisibility: toggleOverlayTaskListVisibility,
      }}
    />
  );
  const noticeEl = <CalendarNoticeBar availability={availability} labels={L} locale={locale} />;
  const headerEl = (
    <CalendarWorkspaceHeader
      L={L}
      title={title}
      compactTitle={compactTitle}
      view={view}
      presentation={presentation}
      searching={searching}
      wideList={wideList}
      multiSelected={multiSelected}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      searchQuery={searchQuery}
      onSearchInput={setSearchQuery}
      searchInputRef={searchInputRef}
      onPresentationChange={setPresentation}
      onMenuOpenChange={setViewMenuOpen}
      onSelectView={selectView}
      onToday={goToday}
      onPrevious={goPrevious}
      onNext={goNext}
      invitationsTrigger={
        <CalendarInvitationsTrigger
          count={pendingInvitationCount(inviteeNotifications)}
          open={invitationsOpen}
          labels={L}
          onToggle={toggleInvitationsOpen}
        />
      }
    />
  );
  const mainEl = (
    <div
      className="calendar-main"
      data-view={view}
      data-view-menu-open={viewMenuOpen ? "true" : undefined}
    >
      <div className="calendar-main__range">
        <CalendarSurface
          view={litSurface.view}
          presentation={litSurface.presentation}
          startDate={anchor}
          {...surfaceDisplay}
          events={surfaceEventsForView ?? surface?.events ?? new Map()}
          taskDueMarkers={taskDueOverlay.overlayEvents}
          availabilityBlocks={availability.overlayEvents}
          visibleCalendarIds={[...visibleCalendarIds]}
          selectedCalendarId={defaultCalendarId}
          contextValue={surface?.contextValue}
          requestRecurrenceScope={askRecurrenceScope}
          onRecurrenceFutureDelete={truncateSeriesFromOccurrence}
          onRecurrenceFutureUpdate={splitSeriesFromDrag}
          onEventSelected={openEventPreview}
          onEventTimesDraft={onEventTimesDraft}
          onViewChange={selectView}
          onStartDateChange={setAnchor}
          onCreateRequested={
            operations
              ? (intent) => {
                  const calendar = calendars.find((entry) => entry.id === defaultCalendarId);
                  if (!canWriteCalendarCollection(calendar)) return;
                  closeEventPreview();
                  openCreateFromSurface(intent);
                }
              : undefined
          }
          pendingCreateIntent={pendingCreateIntent}
          selectedEventKey={
            overlayPreview
              ? overlayPreview.key
              : liveEventPreview && (previewCanResize || listLayout)
                ? eventPreviewOccurrenceKey(liveEventPreview)
                : ""
          }
        />
      </div>
    </div>
  );
  const listContentEl = searching ? (
    <CalendarSearchResultsList
      results={searchResults}
      calendars={calendars}
      timezone={surfaceDisplay.timezone}
      activeKey={activeEventKey}
      labels={L}
      locale={locale}
      selection={listSelection.selection}
    />
  ) : (
    <CalendarEventList
      days={periodDays}
      calendars={calendars}
      locale={locale}
      activeKey={activeEventKey}
      {...listSelection.selection}
      emptyLabel={L.noEventsInRange}
      untitledLabel={L.untitledEvent}
    />
  );
  const panelEl = useInvitationsDrawer ? undefined : (
    <div
      className="workspace-app-layout__panel calendar-workspace__invitations-panel"
      data-open={invitationsOpen ? "true" : "false"}
      aria-hidden={!invitationsOpen}
      inert={!invitationsOpen || undefined}
    >
      {invitationsPanel}
    </div>
  );
  /** The event open in the popover (grid) or the detail pane (list mode). */
  const detailPreview: CalendarEventPreviewModel | null = pointerCreatePreview
    ? pointerCreatePreview
    : liveEventPreview
      ? eventPreview?.interactiveEdit && editor?.mode === "edit"
        ? { ...liveEventPreview, form: editor.form }
        : liveEventPreview
      : null;
  const detailPendingSync = liveEventPreview
    ? (pendingEventIds?.has(liveEventPreview.eventId) ?? false)
    : false;
  /** What every kind of event form shares: the invitees, the session, meetings. */
  const formContext = {
    invitees: invitations.invitees,
    sessionEmail,
    sessionUsername: session.user.username,
    sessionDisplayName: session.user.displayName,
    meetOperations,
    workspaceOrigin,
    onJoinMeeting,
  };
  const contactProps = {
    contactCards,
    onRefreshContactCards: refreshCards,
    canSubmitEmail: invitations.canSubmitEmail,
  };
  /** An RSVP answers the event's invitation (its id), or the event itself without one. */
  const notificationIdFor = (eventId: string) =>
    inviteeNotifications.find((row) => row.eventId === eventId || row.id === eventId)?.id ??
    eventId;
  /** The form props for the open event: create, edit, or an invitation to answer. */
  const eventEditProps = (
    variant: "popover" | "pane",
  ): CalendarEventDetailsPopoverEditProps | undefined =>
    pointerCreateOpen && editor?.mode === "create"
      ? {
          mode: "create",
          form: editor.form,
          onChange: setEditorForm,
          onClose: closeInteractiveEditor,
          onSave: () => {
            saveEditor();
            setEventPreview(null);
            setEventTimesDraft(null);
          },
          ...formContext,
          ...contactProps,
        }
      : eventPreview?.interactiveEdit && editor?.mode === "edit"
        ? {
            form: editor.form,
            onChange: setEditorForm,
            onClose: closeInteractiveEditor,
            onSave: (scope) => {
              if (variant === "pane") return editorAutosave.saveNow(scope);
              saveEditor(scope);
              setEventPreview(null);
              setEventTimesDraft(null);
            },
            onDelete: deleteEditedEvent,
            ...formContext,
            ...contactProps,
            recurrenceId: editor.recurrenceId,
            thisInstanceLocked:
              Boolean(editor.recurrenceId) &&
              occurrenceHasThisInstanceOverride(
                data.events.find((entry) => entry.id === editor.eventId),
                editor.recurrenceId ?? "",
              ),
            onRsvp: (status, calendarId) => {
              return persistRsvp(notificationIdFor(editor.eventId), status, calendarId, {
                source: "dialog",
                editorRecurrenceId: editor.recurrenceId,
              }).then((persisted) => {
                // The pane stays on the event; the popover closes.
                if (persisted && variant !== "pane") closeInteractiveEditor();
                return persisted;
              });
            },
          }
        : eventPreview?.invitation && liveEventPreview
          ? {
              mode: "invitation",
              form: liveEventPreview.form,
              onChange: () => undefined,
              onClose: closeEventPreview,
              onSave: () => undefined,
              ...formContext,
              onRsvp: (status, calendarId) =>
                persistRsvp(notificationIdFor(liveEventPreview.eventId), status, calendarId, {
                  source: "preview",
                  editorRecurrenceId: liveEventPreview.recurrenceId,
                  attendees: liveEventPreview.form.attendees,
                }),
            }
          : undefined;
  const eventPopoverEl =
    detailsPopoverOpen && detailPreview ? (
      <CalendarEventDetailsPopover
        open
        preview={detailPreview}
        origin={
          pointerCreateOpen && editor?.mode === "create" ? editor.origin : eventPreview?.origin
        }
        calendars={calendars}
        labels={L}
        locale={locale}
        untitledLabel={L.untitledEvent}
        pendingSync={detailPendingSync}
        canEdit={pointerCreateOpen || previewCanEdit}
        busy={editorBusy || invitations.busy}
        sessionEmail={sessionEmail}
        meetOperations={meetOperations}
        workspaceOrigin={workspaceOrigin}
        onJoinMeeting={onJoinMeeting}
        onClose={
          pointerCreateOpen || eventPreview?.interactiveEdit
            ? closeInteractiveEditor
            : closeEventPreview
        }
        edit={eventEditProps("popover")}
        onDelete={
          pointerCreateOpen || eventPreview?.interactiveEdit || eventPreview?.invitation
            ? undefined
            : previewCanEdit
              ? deleteFromPreview
              : undefined
        }
        onRsvp={
          pointerCreateOpen || eventPreview?.invitation || eventPreview?.interactiveEdit
            ? undefined
            : liveEventPreview
              ? (status) =>
                  persistRsvp(notificationIdFor(liveEventPreview.eventId), status, undefined, {
                    source: "preview",
                    editorRecurrenceId: liveEventPreview.recurrenceId,
                    attendees: liveEventPreview.form.attendees,
                  })
              : undefined
        }
      />
    ) : null;
  const eventPaneEl =
    listLayout && detailsPopoverOpen && detailPreview ? (
      <CalendarEventPane
        preview={detailPreview}
        calendars={calendars}
        labels={L}
        locale={locale}
        busy={editorBusy || invitations.busy}
        pendingSync={detailPendingSync}
        edit={eventEditProps("pane")}
      />
    ) : null;

  const workspaceClassName = cn(
    "calendar-workspace",
    invitationsShown && "calendar-workspace--panel-open",
    listLayout && "calendar-workspace--list note-detail-desk",
    className,
  );

  return (
    <TooltipProvider delayDuration={300}>
      {listLayout ? (
        <WorkspaceApp
          ref={listWorkspaceRef}
          workspaceRoot={{ className: workspaceClassName }}
          sidebar={() => sidebarEl}
          list={() => ({
            header: headerEl,
            listTop: noticeEl,
            listContent: listContentEl,
            hasItems: true,
            emptyLabel: "",
            floatingActionBar: listSelection.selectionBar,
          })}
          actionBar={(chrome) => {
            // Phones: a bar only on the open overlay (Back + Delete).
            if (detailOverlay && !chrome.detailOpenMobile) return null;
            const back = detailOverlay;
            if (!back && !wideList && !detailDelete) return null;
            return (
              <ActionBar
                onBack={back ? goBack : undefined}
                backLabel={title}
                rightActions={
                  detailDelete && !multiSelected
                    ? [
                        {
                          id: "delete",
                          label: L.delete,
                          icon: <Trash2 />,
                          onClick: detailDelete,
                          severity: "danger",
                          disabled: editorBusy,
                        },
                      ]
                    : undefined
                }
                rightMenuLabel="More actions"
                rightMenuIcon={<MoreHorizontal />}
              />
            );
          }}
          detailClassName="calendar-event-detail-pane"
          detailScrollResetKey={activeEventKey ?? null}
          detail={() =>
            multiSelected ? (
              <MultiSelectionView
                count={listSelection.selectedIds.length}
                label={L.selectionLabel}
                title={L.selectionTitle}
                actions={listSelection.selectionBarButtons}
              />
            ) : (
              (eventPaneEl ?? (
                <CollectionState icon={<CalendarDays className="size-12" />}>
                  {L.selectEvent}
                </CollectionState>
              ))
            )
          }
        />
      ) : (
        <WorkspaceAppLayout
          className={workspaceClassName}
          sidebar={sidebarEl}
          mainNotice={noticeEl}
          mainHeader={headerEl}
          main={mainEl}
          panel={panelEl}
        />
      )}
      {useInvitationsDrawer ? (
        <SideDrawer
          open={invitationsShown}
          onClose={() => setInvitationsOpen(false)}
          title={L.invitationsSection}
          className={`${DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS} calendar-invitations-panel-drawer`}
        >
          {invitationsPanel}
        </SideDrawer>
      ) : null}
      {listLayout ? null : eventPopoverEl}
      {confirmDialog}
      {listSelection.moveDialog}
      {overlayPreview ? (
        <CalendarOverlayPopover
          preview={overlayPreview}
          labels={L}
          locale={locale}
          timeZone={surfaceDisplay.timezone}
          onClose={closeEventPreview}
          onOpenInTasks={onOpenTaskInTasks}
        />
      ) : null}
      {menuCreateOpen && editor?.mode === "create" ? (
        <CalendarEventDialog
          open
          mode="create"
          heading
          form={editor.form}
          calendars={calendars}
          labels={L}
          locale={locale}
          busy={editorBusy || invitations.busy}
          onChange={setEditorForm}
          onClose={closeEditor}
          onSave={saveEditor}
          invitees={invitations.invitees}
          contactCards={contactCards}
          onRefreshContactCards={refreshCards}
          canSubmitEmail={invitations.canSubmitEmail}
          noTeam={attendeePickerNoTeam}
          sessionEmail={sessionEmail}
          sessionUsername={session.user.username}
          sessionDisplayName={session.user.displayName}
          meetOperations={meetOperations}
          workspaceOrigin={workspaceOrigin}
          onJoinMeeting={onJoinMeeting}
        />
      ) : null}
      <CalendarCalendarDialog
        dialog={calendarDialog}
        labels={L}
        groups={directoryGroups}
        personalOwnerLabel={ownerLabel}
        busy={calendarDialogBusy}
        publish={
          calendarDialog?.mode === "edit" && calendarDialog.canPublish
            ? {
                feed: publishFeed,
                busy: publishBusy,
                onToggle: toggleCalendarPublish,
                onCopyHttps: () => void copyCalendarFeedUrl(),
              }
            : undefined
        }
        share={
          editCalendar && canManageCalendarSharing(editCalendar)
            ? {
                calendar: editCalendar,
                knownPrincipals: sharePrincipals,
                online,
                noTeam,
                onSearchPrincipals: searchSharePrincipals,
                onPatchShareWith: patchShareWith,
              }
            : undefined
        }
        onClose={closeCalendarDialog}
        onConfirm={saveCalendarDialog}
        onDelete={
          calendarDialog?.mode === "edit" && calendarDialog.mayDelete
            ? deleteCalendarFromDialog
            : undefined
        }
      />
      <input
        ref={icsFileInputRef}
        type="file"
        accept={ICS_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = icsFileFromList(event.target.files);
          event.target.value = "";
          if (!file) return;
          beginImport(file);
        }}
      />
      {importFile ? (
        <CalendarImportDialog
          open={importDialogOpen}
          file={importFile}
          labels={L}
          calendars={calendars}
          preferredCalendarId={defaultCalendarId}
          busy={importDialogBusy}
          error={importDialogError}
          onClose={closeImportDialog}
          onImport={submitImportDialog}
        />
      ) : null}
      <CalendarRecurrenceScopeDialog dialog={recurrenceScopeDialog} labels={L} />
    </TooltipProvider>
  );
}
