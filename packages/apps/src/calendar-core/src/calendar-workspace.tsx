import { CalendarDays, ChevronLeft, ChevronRight, Circle, Eye, Rss } from "lucide-react";
import { Temporal } from "@js-temporal/polyfill";
import {
  type ChangeEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, IconButton } from "@/button/src/button";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { useAppToast } from "@/hooks/use-app-toast";
import { CalendarSchedulingGoneError } from "@/lib/api/wgw/calendar-scheduling";
import { TooltipProvider } from "@/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { ViewModeToggle } from "@/view-mode-toggle/src/view-mode-toggle";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { CollectionSearchInput } from "@/collection-search-input/src/collection-search-input";
import { useViewHeaderSearchQuery } from "@/view-header/src/use-view-header-search-query";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import { CalendarSearchResultsList } from "@/calendar-core/src/calendar-search-results";
import { CALENDAR_SEARCH_MIN_QUERY_LENGTH } from "@/calendar-core/src/calendar-route-search";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
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
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
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
  calendarDirectoryGroupsFromBootstrap,
  personalOwnerLabel,
} from "@/calendar-core/src/calendar-workspace-props";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  normalizeParticipationStatus,
  organizerAddress,
  sessionEventInviteeStatus,
  type CalendarAttendee,
} from "@/calendar-core/src/calendar-attendees";
import { occurrenceHasThisInstanceOverride } from "@/calendar-core/src/calendar-recurrence-scope";
import {
  eventIsRecurringForRsvp,
  persistInviteeRsvp,
  rsvpRecurrenceIdForEvent,
  type CalendarRsvpPersistSource,
} from "@/calendar-core/src/calendar-rsvp-scope";
import type { CalendarInfo, CalendarViewId } from "@/calendar-core/src/calendar-types";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import {
  canManageCalendarSharing,
  canOpenCalendarSettings,
  canWriteCalendarCollection,
  isCalendarEventFormReadOnly,
} from "@/calendar-core/src/calendar-collection-write";
import {
  calendarSharePrincipalsFromDirectory,
  filterCalendarSharePrincipals,
  isSharedWithMeCalendar,
  type CalendarShareWith,
} from "@/calendar-core/src/calendar-share";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  ownedAndTeamCalendarsForSidebar,
  sharedWithMeCalendarsForSidebar,
} from "@/calendar-core/src/calendar-sidebar-order";
import { isSubscribedCalendar } from "@/calendar-core/src/calendar-subscription";
import { calendarPeriodNavLabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { SideDrawer } from "@/ui/side-drawer";
import { DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS } from "@/text-editor-core/docs-collab/docs-collab-card";
import { useDocsCommentsLayout } from "@/text-editor-core/docs-collab/use-docs-comments-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import "./calendar-workspace.css";

/** Day → Year by time span — list is a presentation toggle, not a dropdown option. */
const VIEW_ORDER: CalendarViewId[] = ["day", "week", "month", "year"];

function closeSidebarOnMobile(close: () => void) {
  if (!isSidebarOverlayViewport()) return;
  close();
}

function CalendarSidebarRows({
  calendars,
  hiddenCalendarIds,
  defaultCalendarId,
  canDeleteCalendars,
  canUnsubscribe,
  editLabel,
  subscribedLabel,
  viewOnlyLabel,
  pendingCalendarIds,
  pendingSyncLabel,
  onToggleVisibility,
  onSelectDefault,
  onEdit,
}: {
  calendars: CalendarInfo[];
  hiddenCalendarIds: ReadonlySet<string>;
  defaultCalendarId?: string;
  canDeleteCalendars: boolean;
  canUnsubscribe: boolean;
  editLabel: string;
  subscribedLabel: string;
  viewOnlyLabel: string;
  pendingCalendarIds?: ReadonlySet<string>;
  pendingSyncLabel: string;
  onToggleVisibility: (calendarId: string) => void;
  onSelectDefault: (calendarId: string) => void;
  onEdit: (calendarId: string) => void;
}) {
  return (
    <>
      {calendars.map((calendar) => {
        const visible = !hiddenCalendarIds.has(calendar.id);
        const subscribed = isSubscribedCalendar(calendar);
        const viewOnly = !canWriteCalendarCollection(calendar);
        const mayEdit = canOpenCalendarSettings(calendar);
        const mayDelete = subscribed
          ? canUnsubscribe
          : (calendar.mayDelete !== false || isSharedWithMeCalendar(calendar)) &&
            canDeleteCalendars;
        const canManage = mayEdit || mayDelete;
        const selected = calendar.id === defaultCalendarId;
        return (
          <CollectionSidebarRow
            key={calendar.id}
            blockName="calendar-sidebar-row"
            name={calendar.name}
            color={calendar.color}
            selected={selected}
            visible={visible}
            onToggleVisibility={() => onToggleVisibility(calendar.id)}
            onSelect={() => onSelectDefault(calendar.id)}
            onEdit={canManage ? () => onEdit(calendar.id) : undefined}
            editLabel={editLabel}
            badges={
              <>
                {subscribed ? (
                  <CollectionSidebarMark
                    label={subscribedLabel}
                    className="calendar-sidebar-row__subscription"
                  >
                    <Rss className="size-3.5" aria-hidden />
                  </CollectionSidebarMark>
                ) : null}
                {viewOnly && !subscribed ? (
                  <CollectionSidebarMark
                    label={viewOnlyLabel}
                    className="calendar-sidebar-row__readonly"
                  >
                    <Eye className="size-3.5" aria-hidden />
                  </CollectionSidebarMark>
                ) : null}
              </>
            }
            trailing={
              pendingCalendarIds?.has(calendar.id) ? (
                <span
                  className="calendar-sidebar-row__pending-sync"
                  role="img"
                  aria-label={pendingSyncLabel}
                >
                  <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
                </span>
              ) : null
            }
          />
        );
      })}
    </>
  );
}

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
  const {
    L,
    locale,
    view,
    selectView,
    presentation,
    setPresentation,
    anchor,
    title,
    compactTitle,
    showingToday,
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
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
    undoLatest,
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
  const directoryGroups = calendarDirectoryGroupsFromBootstrap(data);
  const [invitationsOpen, setInvitationsOpen] = useState(false);
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);
  const editCalendar =
    calendarDialog?.mode === "edit"
      ? (calendars.find((calendar) => calendar.id === calendarDialog.calendarId) ?? null)
      : null;
  const sharePrincipals = useMemo(
    () =>
      calendarSharePrincipalsFromDirectory({
        invitees: invitations.invitees,
        groups: directoryGroups,
        excludeUsername: session.user.username,
      }),
    [directoryGroups, invitations.invitees, session.user.username],
  );
  const searchSharePrincipals = useCallback(
    async (query: string) => {
      if (operations?.searchSharePrincipals) {
        return operations.searchSharePrincipals(query);
      }
      return filterCalendarSharePrincipals(query, sharePrincipals);
    },
    [operations, sharePrincipals],
  );
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
  const [viewSelectOpen, setViewSelectOpen] = useState(false);
  const icsFileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchFabExpanded, setSearchFabExpanded] = useState(false);
  const { query: searchFieldQuery, setQuery: setSearchFieldQuery } = useViewHeaderSearchQuery({
    searchValue: searchQuery,
    onSearchInput: setSearchQuery,
    searchMinLength: CALENDAR_SEARCH_MIN_QUERY_LENGTH,
  });
  const collapseSearchFab = useCallback(() => {
    setSearchFabExpanded(false);
  }, []);
  const onSearchDismissPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    searchInputRef.current?.blur();
  };
  const onSearchDismissClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    collapseSearchFab();
  };

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
      calendars,
      closeEditor,
      data.events,
      invitations.invitees,
      openEditEventKey,
      operations,
      pendingDeletedEventIds,
      session.user,
      surface?.events,
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

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn(
          "calendar-workspace",
          invitationsOpen && "calendar-workspace--panel-open",
          className,
        )}
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            primaryButton={
              canWrite ? (
                <CalendarNewMenu
                  labels={L}
                  onCreateEvent={() => {
                    closeEventPreview();
                    openCreateEvent();
                    closeSidebarOnMobile(() => setSidebarOpen(false));
                  }}
                  onCreateCalendar={
                    canCreateCalendar
                      ? () => {
                          openCreateCalendarDialog();
                          closeSidebarOnMobile(() => setSidebarOpen(false));
                        }
                      : undefined
                  }
                  onSubscribeCalendar={
                    canSubscribeCalendar
                      ? () => {
                          openSubscribeCalendarDialog();
                          closeSidebarOnMobile(() => setSidebarOpen(false));
                        }
                      : undefined
                  }
                  onImportEvents={
                    canImportEvents
                      ? () => {
                          closeEventPreview();
                          closeSidebarOnMobile(() => setSidebarOpen(false));
                          icsFileInputRef.current?.click();
                        }
                      : undefined
                  }
                />
              ) : (
                <Button
                  label={L.today}
                  icon={<CalendarDays />}
                  onClick={() => {
                    goToday();
                    closeSidebarOnMobile(() => setSidebarOpen(false));
                  }}
                  size="xl"
                  pill
                  variant="primary"
                  className="w-full"
                />
              )
            }
            footer={
              <WorkspaceUserFooter
                name={session.user.displayName}
                initials={workspaceUserInitials(session.user)}
                detailLine={session.user.email}
                onLogoutClick={onLogout}
              />
            }
          >
            <SidebarSection title={L.myCalendarsSection}>
              <CalendarSidebarRows
                calendars={myCalendars}
                hiddenCalendarIds={hiddenCalendarIds}
                defaultCalendarId={defaultCalendarId}
                canDeleteCalendars={Boolean(operations?.deleteCalendar)}
                canUnsubscribe={Boolean(operations?.unsubscribeCalendar)}
                editLabel={L.editCalendar}
                subscribedLabel={L.subscribedCalendarBadge}
                viewOnlyLabel={L.viewOnlyCalendarBadge}
                pendingCalendarIds={pendingCalendarIds}
                pendingSyncLabel={L.pendingSync}
                onToggleVisibility={toggleCalendarVisibility}
                onSelectDefault={selectDefaultCalendar}
                onEdit={openEditCalendarDialog}
              />
            </SidebarSection>
            {sharedWithMeCalendars.length > 0 ? (
              <SidebarSection title={L.sharedWithMeSection}>
                <CalendarSidebarRows
                  calendars={sharedWithMeCalendars}
                  hiddenCalendarIds={hiddenCalendarIds}
                  defaultCalendarId={defaultCalendarId}
                  canDeleteCalendars={Boolean(operations?.deleteCalendar)}
                  canUnsubscribe={Boolean(operations?.unsubscribeCalendar)}
                  editLabel={L.editCalendar}
                  subscribedLabel={L.subscribedCalendarBadge}
                  viewOnlyLabel={L.viewOnlyCalendarBadge}
                  pendingCalendarIds={pendingCalendarIds}
                  pendingSyncLabel={L.pendingSync}
                  onToggleVisibility={toggleCalendarVisibility}
                  onSelectDefault={selectDefaultCalendar}
                  onEdit={openEditCalendarDialog}
                />
              </SidebarSection>
            ) : null}
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            title={searchActive ? L.searchTitle : title}
            compactTitle={searchActive ? undefined : compactTitle}
            layout="responsive"
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            titleLeading={
              <div className="calendar-header-nav">
                <IconButton
                  label={periodNav.previous}
                  icon={<ChevronLeft className="size-4" />}
                  size="md"
                  variant="outline"
                  disabled={searchActive}
                  onClick={goPrevious}
                />
                <IconButton
                  label={periodNav.next}
                  icon={<ChevronRight className="size-4" />}
                  size="md"
                  variant="outline"
                  disabled={searchActive}
                  onClick={goNext}
                />
                <IconButton
                  className="calendar-header-today"
                  label={L.today}
                  icon={<CalendarDays className="size-4" />}
                  size="md"
                  variant="outline"
                  active={showingToday}
                  aria-pressed={showingToday}
                  disabled={searchActive}
                  onClick={goToday}
                />
              </div>
            }
            titleTrailing={
              <CalendarInvitationsTrigger
                count={pendingInvitationCount(inviteeNotifications)}
                open={invitationsOpen}
                labels={L}
                onToggle={toggleInvitationsOpen}
              />
            }
            actions={
              <div className="calendar-header-actions">
                <div
                  className="calendar-search-host"
                  onFocusCapture={() => setSearchFabExpanded(true)}
                  onKeyDownCapture={(event) => {
                    if (event.key === "Escape") collapseSearchFab();
                  }}
                >
                  {searchFabExpanded ? (
                    <div
                      className="calendar-search-dismiss"
                      aria-hidden
                      onPointerDown={onSearchDismissPointerDown}
                      onClick={onSearchDismissClick}
                    />
                  ) : null}
                  <CollectionSearchInput
                    inputRef={searchInputRef}
                    value={searchFieldQuery}
                    onChange={setSearchFieldQuery}
                    placeholder={L.searchPlaceholder}
                    className={
                      searchFabExpanded
                        ? "calendar-search-field calendar-search-field--expanded"
                        : "calendar-search-field"
                    }
                  />
                </div>
                <Select
                  value={view}
                  disabled={searchActive}
                  onOpenChange={setViewSelectOpen}
                  onValueChange={(next) => selectView(next as CalendarViewId)}
                >
                  <SelectTrigger
                    size="md"
                    className="calendar-view-select"
                    aria-label={L.viewSelectLabel}
                    disabled={searchActive}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIEW_ORDER.map((id) => (
                      <SelectItem key={id} value={id}>
                        {viewLabels[id]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ViewModeToggle
                  value={presentation}
                  onChange={setPresentation}
                  gridLabel={L.showAsCalendar}
                  listLabel={L.showAsList}
                  disabled={searchActive}
                />
              </div>
            }
          />
        }
        main={
          <div
            className={cn("calendar-main", searchActive && "calendar-main--search")}
            data-view={view}
            data-view-select-open={viewSelectOpen ? "true" : undefined}
          >
            {searchActive ? (
              <CalendarSearchResultsList
                results={searchResults}
                searchRange={searchRange}
                visibleCalendars={calendars.filter((calendar) =>
                  visibleCalendarIds.has(calendar.id),
                )}
                labels={L}
                locale={locale}
                onEventSelected={openEventPreview}
              />
            ) : (
              <div className="calendar-main__range">
                <CalendarSurface
                  view={litSurface.view}
                  presentation={litSurface.presentation}
                  startDate={anchor}
                  events={surfaceEventsForView ?? surface?.events ?? new Map()}
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
                          const calendar = calendars.find(
                            (entry) => entry.id === defaultCalendarId,
                          );
                          if (!canWriteCalendarCollection(calendar)) return;
                          closeEventPreview();
                          openCreateFromSurface(intent);
                        }
                      : undefined
                  }
                  pendingCreateIntent={pendingCreateIntent}
                  selectedEventKey={
                    liveEventPreview && previewCanResize
                      ? eventPreviewOccurrenceKey(liveEventPreview)
                      : ""
                  }
                />
              </div>
            )}
          </div>
        }
        panel={
          useInvitationsDrawer ? undefined : (
            <div
              className="workspace-app-layout__panel calendar-workspace__invitations-panel"
              data-open={invitationsOpen ? "true" : "false"}
              aria-hidden={!invitationsOpen}
              inert={!invitationsOpen || undefined}
            >
              {invitationsPanel}
            </div>
          )
        }
      />
      {useInvitationsDrawer ? (
        <SideDrawer
          open={invitationsOpen}
          onClose={() => setInvitationsOpen(false)}
          title={L.invitationsSection}
          className={`${DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS} calendar-invitations-panel-drawer`}
        >
          {invitationsPanel}
        </SideDrawer>
      ) : null}
      {detailsPopoverOpen && (pointerCreatePreview || liveEventPreview) ? (
        <CalendarEventDetailsPopover
          open
          preview={
            pointerCreatePreview
              ? pointerCreatePreview
              : eventPreview?.interactiveEdit && editor?.mode === "edit"
                ? { ...liveEventPreview!, form: editor.form }
                : liveEventPreview!
          }
          origin={
            pointerCreateOpen && editor?.mode === "create" ? editor.origin : eventPreview?.origin
          }
          calendars={calendars}
          labels={L}
          locale={locale}
          untitledLabel={L.untitledEvent}
          pendingSync={
            liveEventPreview ? (pendingEventIds?.has(liveEventPreview.eventId) ?? false) : false
          }
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
          edit={
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
                      saveEditor(scope);
                      setEventPreview(null);
                      setEventTimesDraft(null);
                    },
                    onDelete: () => {
                      deleteEditorEvent();
                      setEventPreview(null);
                      setEventTimesDraft(null);
                    },
                    invitees: invitations.invitees,
                    contactCards,
                    onRefreshContactCards: refreshCards,
                    canSubmitEmail: invitations.canSubmitEmail,
                    sessionEmail,
                    sessionUsername: session.user.username,
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
                        if (persisted) closeInteractiveEditor();
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
                  : undefined
          }
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
                    const notification = inviteeNotifications.find(
                      (row) => row.eventId === eventId,
                    );
                    return persistRsvp(notification?.id ?? eventId, status, undefined, {
                      source: "preview",
                      editorRecurrenceId: liveEventPreview.recurrenceId,
                      attendees: liveEventPreview.form.attendees,
                    });
                  }
                : undefined
          }
        />
      ) : null}
      {menuCreateOpen && editor?.mode === "create" ? (
        <CalendarEventDialog
          open
          mode="create"
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
          sessionEmail={sessionEmail}
          sessionUsername={session.user.username}
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
