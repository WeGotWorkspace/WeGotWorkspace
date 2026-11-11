import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
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
import { IconButton } from "@/button/src/button";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";
import {
  CalendarSidebarRows,
  MyCalendarsSidebarSection,
} from "@/calendar-core/src/calendar-sidebar-rows";
import { CalendarAvailabilitySidebar } from "@/calendar-core/src/calendar-availability-sidebar";
import { CalendarNoticeBar } from "@/calendar-core/src/calendar-notice-bar";
import { useTeamAvailability } from "@/calendar-core/src/use-team-availability";
import { useAppToast } from "@/hooks/use-app-toast";
import { CalendarSchedulingGoneError } from "@/lib/api/wgw/calendar-scheduling";
import { TooltipProvider } from "@/ui/tooltip";
import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { WorkspaceApp, type WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import { ActionBar } from "@/action-bar/src/action-bar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { CollectionState } from "@/collection-state/src/collection-state";
import { ViewHeader } from "@/view-header/src/view-header";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import { CalendarSearchResultsList } from "@/calendar-core/src/calendar-search-results";
import { useCalendarListSelection } from "@/calendar-core/src/use-calendar-list-selection";
import { unifiedSearchOccurrences } from "@/calendar-core/src/calendar-search";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { CalendarEventList } from "@/calendar-core/src/calendar-event-list";
import { groupAgendaDays } from "@/lib/calendar-elements/utils/agenda-days";
import { visibleEventsInRange } from "@/lib/calendar-elements/CalendarViewBase/renderedEvents";
import { filterVisibleCalendarEventsKeepingOverlay } from "@/calendar-core/src/calendar-task-due-overlay";
import { CALENDAR_SEARCH_MIN_QUERY_LENGTH } from "@/calendar-core/src/calendar-route-search";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import {
  filterInviteeNotifications,
  pendingInvitationCount,
} from "@/calendar-core/src/calendar-invitation-event";
import { CalendarInvitationsPanel } from "@/calendar-core/src/calendar-invitations-panel";
import { CalendarInvitationsTrigger } from "@/calendar-core/src/calendar-invitations-trigger";
import { useCalendarEditorAutosave } from "@/calendar-core/src/use-calendar-editor-autosave";
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
import {
  CalendarRemindersSidebar,
  partitionCalendarTaskDueSidebarLists,
} from "@/calendar-core/src/calendar-task-due-sidebar";
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
import type { CalendarViewId } from "@/lib/models/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import {
  canManageCalendarSharing,
  canWriteCalendarCollection,
  isCalendarEventFormReadOnly,
} from "@/calendar-core/src/calendar-collection-write";
import type { CalendarShareWith } from "@/calendar-core/src/calendar-share";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ownedAndTeamCalendarsForSidebar,
  sharedWithMeCalendarsForSidebar,
} from "@/calendar-core/src/calendar-sidebar-order";
import { calendarPeriodNavLabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { CALENDAR_VIEW_ORDER } from "@/calendar-core/src/calendar-workspace-nav";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";
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
    searchRange,
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
  const myCalendars = ownedAndTeamCalendarsForSidebar(calendars);
  const sharedWithMeCalendars = sharedWithMeCalendarsForSidebar(calendars);
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

  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    year: L.viewYear,
  };
  const periodNav = calendarPeriodNavLabels(view, L);
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
  const listWorkspaceRef = useRef<WorkspaceAppHandle>(null);
  /** Below `md` the detail pane slides over the list and needs a back button. */
  const detailOverlay = useIsMobile();
  const eventSelected = Boolean(eventPreview);
  useEffect(() => {
    if (!listLayout) return;
    if (eventSelected) listWorkspaceRef.current?.openMobileDetail();
    else listWorkspaceRef.current?.closeMobileDetail();
  }, [eventSelected, listLayout]);
  const closeEventDetail = eventPreview?.interactiveEdit
    ? closeInteractiveEditor
    : closeEventPreview;
  /** Phones: clear the selection inside the overlay's slide-out (as Tasks does), so it
   * slides the event away, not an emptied pane with only its header. */
  const leaveEventDetail = (clear: () => void) => {
    if (detailOverlay && listWorkspaceRef.current)
      listWorkspaceRef.current.closeMobileDetail(clear);
    else clear();
  };
  /** Search lives in list mode only (the floating bar over the list). */
  const searching = listLayout && searchActive;
  /** The pane saves as you go, like a task or a note; the grid's popover keeps Save. */
  const paneEditing = listLayout && Boolean(eventPreview?.interactiveEdit);
  const editorAutosave = useCalendarEditorAutosave({ editor, enabled: paneEditing, saveEditor });
  const deleteEditedEvent = () => {
    editorAutosave.cancel();
    deleteEditorEvent();
    setEventPreview(null);
    setEventTimesDraft(null);
  };
  const detailDeleteNow =
    eventPreview?.interactiveEdit && editor?.mode === "edit"
      ? deleteEditedEvent
      : eventPreview && !eventPreview.invitation && previewCanEdit
        ? deleteFromPreview
        : undefined;
  /** Detail header Delete: asks first. A repeating occurrence already asks which ones
   * (the scope dialog), so it goes straight on. */
  const detailDelete =
    detailDeleteNow &&
    (liveEventPreview?.recurrenceId
      ? () => leaveEventDetail(detailDeleteNow)
      : () =>
          requestConfirm({
            title: L.deleteEventConfirmTitle,
            description: L.deleteEventConfirmBody,
            confirmLabel: L.delete,
            cancelLabel: L.cancel,
            variant: "destructive",
            onConfirm: () => leaveEventDetail(detailDeleteNow),
          }));
  /** Wide list mode: the list header has room for the full range title. */
  const wideList = listLayout && !detailOverlay;
  /** The invitations inbox is the grid's: list mode has no trigger and hides the panel
   * (it is back on switching to the grid). */
  const invitationsShown = invitationsOpen && !listLayout;
  const viewModeToggleEl = (
    <ViewModeToggle
      value={presentation}
      onChange={setPresentation}
      gridLabel={L.showAsCalendar}
      listLabel={L.showAsList}
      disabled={searching}
      variant="menu"
      onOpenChange={setViewMenuOpen}
    />
  );
  const invitationsTriggerEl = (
    <CalendarInvitationsTrigger
      count={pendingInvitationCount(inviteeNotifications)}
      open={invitationsOpen}
      labels={L}
      onToggle={toggleInvitationsOpen}
    />
  );
  const listEvents = surfaceEventsForView ?? surface?.events;
  const periodDays = useMemo(() => {
    if (!listLayout) return [];
    const timezone = surfaceDisplay.timezone;
    const midnight = { hour: 0, minute: 0, second: 0 } as const;
    const visible = filterVisibleCalendarEventsKeepingOverlay(listEvents ?? new Map(), [
      ...visibleCalendarIds,
    ]);
    const expanded = visibleEventsInRange(
      visible,
      {
        start: dateRange.start.toPlainDateTime(midnight),
        end: dateRange.end.toPlainDateTime(midnight),
      },
      timezone,
    );
    return groupAgendaDays(expanded.entries(), { timezone, range: dateRange });
  }, [dateRange, listEvents, listLayout, surfaceDisplay.timezone, visibleCalendarIds]);
  const activeEventKey = liveEventPreview ? eventPreviewOccurrenceKey(liveEventPreview) : undefined;
  /** The list's rows in order, with each one's calendar (period list or search results). */
  const listRows = useMemo(() => {
    const rows = new Map<string, string>();
    if (searching) {
      for (const occurrence of unifiedSearchOccurrences(searchResults)) {
        rows.set(occurrence.key, occurrence.calendarId);
      }
    } else {
      for (const day of periodDays) {
        for (const item of day.items) rows.set(item.id, item.event.calendarId);
      }
    }
    return rows;
  }, [periodDays, searchResults, searching]);
  const listRowIds = useMemo(() => [...listRows.keys()], [listRows]);
  const listRowCalendarId = useCallback((key: string) => listRows.get(key), [listRows]);
  const listSelection = useCalendarListSelection({
    L,
    visibleIds: listRowIds,
    resetKey: `${presentation}|${view}|${anchor}|${searching ? searchQuery : ""}`,
    activeKey: activeEventKey ?? "",
    calendars,
    calendarIdOf: listRowCalendarId,
    openEvent: openEventPreview,
    requestConfirm,
    deleteEvents: (keys) => {
      if (activeEventKey && keys.includes(activeEventKey)) leaveEventDetail(closeEventDetail);
      deleteCalendarEvents(keys);
    },
    moveEvents: moveCalendarEvents,
  });
  const multiSelected = listLayout && listSelection.multiSelected;

  const sidebarEl = (
    <AppSidebar
      settingsAppId="calendar"
      open={sidebarOpen}
      onCloseMobile={() => setSidebarOpen(false)}
      primaryButton={
        canWrite ? (
          <CalendarNewMenu
            labels={L}
            onCreateEvent={() => {
              closeEventPreview();
              openCreateEvent();
              dismissSidebarOverlay(() => setSidebarOpen(false));
            }}
            onCreateCalendar={
              canCreateCalendar
                ? () => {
                    openCreateCalendarDialog();
                    dismissSidebarOverlay(() => setSidebarOpen(false));
                  }
                : undefined
            }
            onSubscribeCalendar={
              canSubscribeCalendar
                ? () => {
                    openSubscribeCalendarDialog();
                    dismissSidebarOverlay(() => setSidebarOpen(false));
                  }
                : undefined
            }
            onImportEvents={
              canImportEvents
                ? () => {
                    closeEventPreview();
                    dismissSidebarOverlay(() => setSidebarOpen(false));
                    icsFileInputRef.current?.click();
                  }
                : undefined
            }
          />
        ) : (
          <SidebarSegmentedNewMenu
            mainLabel={L.today}
            menuLabel={L.newEventMenu}
            icon={<CalendarDays />}
            onMainAction={() => {
              goToday();
              dismissSidebarOverlay(() => setSidebarOpen(false));
            }}
          />
        )
      }
      footer={
        <WorkspaceSidebarAccountFooter
          session={session}
          detailLine={session.user.email}
          onLogout={onLogout}
        />
      }
    >
      <MyCalendarsSidebarSection
        rowProps={{ calendars: myCalendars, ...calendarRowProps }}
        onSetVisible={setCalendarsVisible}
        labels={L}
      />
      {sharedWithMeCalendars.length > 0 ? (
        <SidebarSection title={L.sharedWithMeSection}>
          <CalendarSidebarRows calendars={sharedWithMeCalendars} {...calendarRowProps} />
        </SidebarSection>
      ) : null}
      <CalendarAvailabilitySidebar availability={availability} labels={L} />
      <CalendarRemindersSidebar
        lists={overlayOwnedLists}
        sharedLists={overlaySharedLists}
        hiddenListIds={hiddenOverlayTaskListIds}
        onSetHiddenListIds={setHiddenOverlayTaskListIds}
        onToggleVisibility={toggleOverlayTaskListVisibility}
        labels={L}
      />
    </AppSidebar>
  );
  const noticeEl = <CalendarNoticeBar availability={availability} labels={L} locale={locale} />;
  /** Grid/list menu, then previous / next for the shown range (Today is in the title's menu). */
  const navEl = (
    <div className="calendar-header-nav">
      {viewModeToggleEl}
      <IconButton
        label={periodNav.previous}
        icon={<ChevronLeft className="size-4" />}
        size="md"
        variant="outline"
        disabled={searching}
        onClick={goPrevious}
      />
      <IconButton
        label={periodNav.next}
        icon={<ChevronRight className="size-4" />}
        size="md"
        variant="outline"
        disabled={searching}
        onClick={goNext}
      />
    </div>
  );
  /** The range title's menu: the period views, then Today. */
  const titleMenu: DropdownMenuEntry[] = [
    ...CALENDAR_VIEW_ORDER.map((id) => ({
      id,
      label: viewLabels[id],
      checked: view === id,
      onClick: () => selectView(id),
    })),
    { type: "separator" as const, id: "today-separator" },
    {
      id: "today",
      label: L.today,
      icon: <CalendarDays />,
      onClick: goToday,
    },
  ];
  const headerEl = (
    <ViewHeader
      title={searching ? L.searchTitle : title}
      // One row everywhere; narrow headers (phones, the grid) fall back to the short range.
      compactTitle={searching || wideList ? undefined : compactTitle}
      titleMenu={searching ? undefined : titleMenu}
      onTitleMenuOpenChange={setViewMenuOpen}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      {...(listLayout
        ? {
            searchPlaceholder: L.searchPlaceholder,
            searchValue: searchQuery,
            onSearchInput: setSearchQuery,
            searchMinLength: CALENDAR_SEARCH_MIN_QUERY_LENGTH,
                  searchHidden: multiSelected,
            searchInputRef,
          }
        : {})}
      // List: the range left, its controls at the end. Grid: the controls right after
      // the range (lined up with list mode's on wide screens, CSS), the inbox last.
      titleSuffix={listLayout ? undefined : navEl}
      titleTrailing={listLayout ? undefined : invitationsTriggerEl}
      actions={listLayout ? navEl : undefined}
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
          invitees: invitations.invitees,
          contactCards,
          onRefreshContactCards: refreshCards,
          canSubmitEmail: invitations.canSubmitEmail,
          sessionEmail,
          sessionUsername: session.user.username,
          sessionDisplayName: session.user.displayName,
          meetOperations,
          workspaceOrigin,
          onJoinMeeting,
        }
      : eventPreview?.interactiveEdit && editor?.mode === "edit"
        ? {
            form: editor.form,
            onChange: setEditorForm,
            onClose: closeInteractiveEditor,
            onSave: (scope) => {
              if (variant === "pane") {
                editorAutosave.cancel();
                saveEditor(scope, { keepOpen: true });
                return;
              }
              saveEditor(scope);
              setEventPreview(null);
              setEventTimesDraft(null);
            },
            onDelete: deleteEditedEvent,
            invitees: invitations.invitees,
            contactCards,
            onRefreshContactCards: refreshCards,
            canSubmitEmail: invitations.canSubmitEmail,
            sessionEmail,
            sessionUsername: session.user.username,
            sessionDisplayName: session.user.displayName,
            recurrenceId: editor.recurrenceId,
            thisInstanceLocked:
              Boolean(editor.recurrenceId) &&
              occurrenceHasThisInstanceOverride(
                data.events.find((entry) => entry.id === editor.eventId),
                editor.recurrenceId ?? "",
              ),
            meetOperations,
            workspaceOrigin,
            onJoinMeeting,
            onRsvp: (status, calendarId) => {
              const notification = inviteeNotifications.find(
                (row) => row.eventId === editor.eventId,
              );
              const id = notification?.id ?? editor.eventId;
              return persistRsvp(id, status, calendarId, {
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
              invitees: invitations.invitees,
              sessionEmail,
              sessionUsername: session.user.username,
              sessionDisplayName: session.user.displayName,
              meetOperations,
              workspaceOrigin,
              onJoinMeeting,
              onRsvp: (status, calendarId) => {
                const eventId = liveEventPreview.eventId;
                const notification = inviteeNotifications.find(
                  (row) => row.eventId === eventId || row.id === eventId,
                );
                return persistRsvp(notification?.id ?? eventId, status, calendarId, {
                  source: "preview",
                  editorRecurrenceId: liveEventPreview.recurrenceId,
                  attendees: liveEventPreview.form.attendees,
                });
              },
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
              ? (status) => {
                  const eventId = liveEventPreview.eventId;
                  const notification = inviteeNotifications.find((row) => row.eventId === eventId);
                  return persistRsvp(notification?.id ?? eventId, status, undefined, {
                    source: "preview",
                    editorRecurrenceId: liveEventPreview.recurrenceId,
                    attendees: liveEventPreview.form.attendees,
                  });
                }
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
                onBack={back ? () => leaveEventDetail(closeEventDetail) : undefined}
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
