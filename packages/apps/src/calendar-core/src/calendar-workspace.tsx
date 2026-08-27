import { CalendarDays, ChevronLeft, ChevronRight, Circle, Eye, Pencil, Rss } from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, IconButton } from "@/button/src/button";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";
import { useAppToast } from "@/hooks/use-app-toast";
import { CalendarSchedulingGoneError } from "@/lib/api/wgw/calendar-scheduling";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import { Checkbox } from "@/ui/checkbox";
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
import { CalendarCalendarDialog } from "@/calendar-core/src/calendar-calendar-dialog";
import { CalendarImportDialog } from "@/calendar-core/src/calendar-import-dialog";
import { ICS_FILE_ACCEPT, icsFileFromList } from "@/calendar-core/src/calendar-ics-import";
import { CalendarRecurrenceScopeDialog } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
import {
  eventPreviewOccurrenceKey,
  resolveCalendarEventPreview,
  type CalendarEventPreviewModel,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import {
  calendarDirectoryGroupsFromBootstrap,
  personalOwnerLabel,
} from "@/calendar-core/src/calendar-workspace-props";
import {
  isSessionEventOrganizer,
  organizerAddress,
  sessionEventInviteeStatus,
  type CalendarAttendee,
} from "@/calendar-core/src/calendar-attendees";
import {
  eventIsRecurringForRsvp,
  persistInviteeRsvp,
  queueUndoableRespond,
  rsvpRecurrenceIdForEvent,
  rsvpUndoStatus,
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
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { SideDrawer } from "@/ui/side-drawer";
import { useDocsCommentsLayout } from "@/text-editor-core/docs-collab/use-docs-comments-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import "./calendar-workspace.css";

/** Day → Year by time span — list is a presentation toggle, not a dropdown option. */
const VIEW_ORDER: CalendarViewId[] = ["day", "week", "month", "year"];

function closeSidebarOnMobile(close: () => void) {
  if (!isSidebarOverlayViewport()) return;
  close();
}

function CalendarSidebarMark({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className} role="img" aria-label={label}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
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
          <li
            key={calendar.id}
            className={cn("calendar-sidebar-row", selected && "calendar-sidebar-row--selected")}
            style={
              {
                "--calendar-row-color": calendar.color || "var(--color-ink)",
              } as CSSProperties
            }
          >
            <Checkbox
              checked={visible}
              aria-label={`${visible ? "Hide" : "Show"} ${calendar.name}`}
              className="calendar-sidebar-row__visibility"
              onCheckedChange={() => onToggleVisibility(calendar.id)}
              onClick={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              className="calendar-sidebar-row__select"
              onClick={() => onSelectDefault(calendar.id)}
            >
              <span className="calendar-sidebar-row__title">
                <span className="calendar-sidebar-row__name">{calendar.name}</span>
                {subscribed ? (
                  <CalendarSidebarMark
                    label={subscribedLabel}
                    className="calendar-sidebar-row__mark calendar-sidebar-row__subscription"
                  >
                    <Rss className="size-3.5" aria-hidden />
                  </CalendarSidebarMark>
                ) : null}
                {viewOnly && !subscribed ? (
                  <CalendarSidebarMark
                    label={viewOnlyLabel}
                    className="calendar-sidebar-row__mark calendar-sidebar-row__readonly"
                  >
                    <Eye className="size-3.5" aria-hidden />
                  </CalendarSidebarMark>
                ) : null}
              </span>
              {pendingCalendarIds?.has(calendar.id) ? (
                <span
                  className="calendar-sidebar-row__pending-sync"
                  role="img"
                  aria-label={pendingSyncLabel}
                >
                  <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
                </span>
              ) : null}
            </button>
            {canManage ? (
              <IconButton
                label={editLabel}
                icon={<Pencil className="size-3.5" aria-hidden />}
                size="sm"
                variant="ghost"
                className="calendar-sidebar-row__action calendar-sidebar-row__edit"
                onClick={() => onEdit(calendar.id)}
              />
            ) : null}
          </li>
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
    queueMutation,
    searchQuery,
    setSearchQuery,
    searchActive,
    searchResults,
    searchRange,
    undoLatest,
  } = controller;
  const { showError } = useAppToast();
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
  } | null>(null);
  const toggleInvitationsOpen = () => {
    if (!invitationsOpen) {
      void invitations.refreshIfIdle().catch(() => undefined);
    }
    setInvitationsOpen((open) => !open);
  };

  const canWrite = Boolean(operations) && calendars.some((c) => canWriteCalendarCollection(c));
  const sessionEmail = organizerAddress(session.user)?.email;
  const previewCalendar = eventPreview
    ? calendars.find((entry) => entry.id === eventPreview.model.form.calendarId)
    : undefined;
  const previewCanEdit =
    Boolean(operations) &&
    !isCalendarEventFormReadOnly({
      mode: "edit",
      calendar: previewCalendar,
      isOrganizer: isSessionEventOrganizer(
        eventPreview?.model.form.attendees ?? [],
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

  useDocumentTitle(title);

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
        respond: (scopeOptions) =>
          queueUndoableRespond({
            queueMutation,
            key: `calendar:rsvp:${notificationId}:${status}`,
            toastMessage: L.toastRsvpUpdated,
            undoToastMessage: L.toastRsvpUndone,
            execute: () =>
              invitations.respond(notificationId, status, {
                ...respondOptions,
                ...scopeOptions,
              }),
            undo: () => {
              const revert = rsvpUndoStatus(previousStatus);
              if (!revert) return;
              void invitations.respond(notificationId, revert, respondOptions);
            },
          }),
      });
    },
    [
      L.toastRsvpUndone,
      L.toastRsvpUpdated,
      askRecurrenceScope,
      data.events,
      editor,
      invitations,
      inviteeNotifications,
      queueMutation,
      session.user,
    ],
  );

  const closeEventPreview = useCallback(() => {
    setEventPreview(null);
  }, []);

  const openEventPreview = useCallback(
    (key: string, origin?: CalendarEventSelectionOrigin) => {
      closeEditor();
      const model = resolveCalendarEventPreview(key, {
        events: data.events,
        surfaceEvents: surface?.events,
        pendingDeletedEventIds,
      });
      if (!model) return;
      setEventPreview({ model, origin });
    },
    [closeEditor, data.events, pendingDeletedEventIds, surface?.events],
  );

  const openEditFromPreview = useCallback(() => {
    if (!eventPreview) return;
    const key = eventPreviewOccurrenceKey(eventPreview.model);
    setEventPreview(null);
    void openEditEventKey(key);
  }, [eventPreview, openEditEventKey]);

  const invitationsPanel = useMemo(
    () => (
      <CalendarInvitationsPanel
        notifications={inviteeNotifications}
        labels={L}
        locale={locale}
        calendars={calendars}
        defaultCalendarId={defaultCalendarId}
        busy={invitations.busy}
        showCloseButton={useInvitationsDrawer}
        onClose={() => setInvitationsOpen(false)}
        onRespond={async (id, status, calendarId) => {
          await persistRsvp(id, status, calendarId, { source: "sidebar" });
        }}
        onOpenEvent={
          canWrite
            ? (key) => {
                closeEventPreview();
                return openEditEventKey(key);
              }
            : undefined
        }
      />
    ),
    [
      L,
      calendars,
      canWrite,
      defaultCalendarId,
      invitations.busy,
      inviteeNotifications,
      locale,
      closeEventPreview,
      openEditEventKey,
      persistRsvp,
      useInvitationsDrawer,
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
                  size="lg"
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
            titlePrefix={
              <IconButton
                className="calendar-header-today-icon"
                label={L.today}
                icon={<CalendarDays className="size-4" />}
                size="sm"
                active={showingToday}
                aria-pressed={showingToday}
                disabled={searchActive}
                onClick={goToday}
              />
            }
            titleLeading={
              <div className="calendar-header-nav">
                <IconButton
                  label={L.previousPeriod}
                  icon={<ChevronLeft className="size-4" />}
                  size="sm"
                  disabled={searchActive}
                  onClick={goPrevious}
                />
                <IconButton
                  label={L.nextPeriod}
                  icon={<ChevronRight className="size-4" />}
                  size="sm"
                  disabled={searchActive}
                  onClick={goNext}
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
                    size="sm"
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
                <Button
                  className={cn("calendar-header-today", showingToday && "icon-button--active")}
                  label={L.today}
                  icon={<CalendarDays />}
                  onClick={goToday}
                  variant="subtle"
                  size="sm"
                  disabled={searchActive}
                  aria-pressed={showingToday}
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
                  onViewChange={selectView}
                  onStartDateChange={setAnchor}
                  onCreateRequested={
                    operations
                      ? (intent) => {
                          const calendarId = intent.calendarId || defaultCalendarId;
                          const calendar = calendars.find((entry) => entry.id === calendarId);
                          if (!canWriteCalendarCollection(calendar)) return;
                          closeEventPreview();
                          openCreateFromSurface(intent);
                        }
                      : undefined
                  }
                  pendingCreateIntent={pendingCreateIntent}
                  selectedEventKey={
                    eventPreview && previewCanResize
                      ? eventPreviewOccurrenceKey(eventPreview.model)
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
          className="calendar-invitations-panel-drawer"
        >
          {invitationsPanel}
        </SideDrawer>
      ) : null}
      {eventPreview ? (
        <CalendarEventDetailsPopover
          open
          preview={eventPreview.model}
          origin={eventPreview.origin}
          calendars={calendars}
          labels={L}
          locale={locale}
          untitledLabel={L.untitledEvent}
          pendingSync={pendingEventIds?.has(eventPreview.model.eventId) ?? false}
          canEdit={previewCanEdit}
          busy={invitations.busy}
          sessionEmail={sessionEmail}
          onClose={closeEventPreview}
          onEdit={previewCanEdit ? openEditFromPreview : undefined}
          onRsvp={(status) => {
            const eventId = eventPreview.model.eventId;
            const notification = inviteeNotifications.find((row) => row.eventId === eventId);
            return persistRsvp(notification?.id ?? eventId, status, undefined, {
              source: "preview",
              editorRecurrenceId: eventPreview.model.recurrenceId,
              attendees: eventPreview.model.form.attendees,
            }).then(() => undefined);
          }}
        />
      ) : null}
      {editor ? (
        <CalendarEventDialog
          open
          mode={editor.mode}
          form={editor.form}
          calendars={calendars}
          labels={L}
          locale={locale}
          busy={editorBusy || invitations.busy}
          onChange={setEditorForm}
          onClose={closeEditor}
          onSave={saveEditor}
          onDelete={editor.mode === "edit" ? deleteEditorEvent : undefined}
          invitees={invitations.invitees}
          canSubmitEmail={invitations.canSubmitEmail}
          sessionEmail={sessionEmail}
          onRsvp={
            editor.mode === "edit"
              ? (status, calendarId) => {
                  const notification = inviteeNotifications.find(
                    (row) => row.eventId === editor.eventId,
                  );
                  const id = notification?.id ?? editor.eventId;
                  return persistRsvp(id, status, calendarId, {
                    source: "dialog",
                    editorRecurrenceId: editor.recurrenceId,
                  }).then((persisted) => {
                    if (persisted) closeEditor();
                  });
                }
              : undefined
          }
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
