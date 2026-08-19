import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Button, IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
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
import { CalendarRecurrenceScopeDialog } from "@/calendar-core/src/calendar-recurrence-scope-dialog";
import { formToCreateIntent } from "@/calendar-core/src/calendar-editor-model";
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import {
  calendarDirectoryGroupsFromBootstrap,
  personalOwnerLabel,
} from "@/calendar-core/src/calendar-workspace-props";
import { organizerAddress } from "@/calendar-core/src/calendar-attendees";
import type { CalendarInfo, CalendarViewId } from "@/calendar-core/src/calendar-types";
import {
  personalCalendarsForSidebar,
  teamCalendarsForSidebar,
} from "@/calendar-core/src/calendar-sidebar-order";
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

function CalendarSidebarRows({
  calendars,
  hiddenCalendarIds,
  defaultCalendarId,
  canDeleteCalendars,
  editLabel,
  onToggleVisibility,
  onSelectDefault,
  onEdit,
}: {
  calendars: CalendarInfo[];
  hiddenCalendarIds: ReadonlySet<string>;
  defaultCalendarId?: string;
  canDeleteCalendars: boolean;
  editLabel: string;
  onToggleVisibility: (calendarId: string) => void;
  onSelectDefault: (calendarId: string) => void;
  onEdit: (calendarId: string) => void;
}) {
  return (
    <>
      {calendars.map((calendar) => {
        const visible = !hiddenCalendarIds.has(calendar.id);
        const mayEdit = calendar.mayWrite !== false;
        const mayDelete = calendar.mayDelete !== false && canDeleteCalendars;
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
              <span className="calendar-sidebar-row__name">{calendar.name}</span>
            </button>
            {canManage ? (
              <IconButton
                label={editLabel}
                icon={<Pencil className="size-3.5" aria-hidden />}
                size="sm"
                variant="ghost"
                className="calendar-sidebar-row__edit"
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
  onViewChange,
  onRouteStateChange,
  onLogout,
  className,
}: CalendarWorkspaceProps) {
  const controller = useCalendarController({
    data,
    labels,
    operations,
    initialView,
    initialPresentation,
    initialAnchor,
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
  const invitations = useCalendarInvitations(operations, {
    onResponded: () => {
      surface?.syncNow();
    },
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
  const [invitationsOpen, setInvitationsOpen] = useState(false);
  const toggleInvitationsOpen = () => {
    if (!invitationsOpen) {
      void invitations.refreshIfIdle().catch(() => undefined);
    }
    setInvitationsOpen((open) => !open);
  };

  const {
    L,
    locale,
    view,
    selectView,
    presentation,
    setPresentation,
    anchor,
    title,
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
    editorBusy,
    openCreateEvent,
    openCreateFromSurface,
    openEditEventKey,
    closeEditor,
    setEditorForm,
    saveEditor,
    deleteEditorEvent,
    setAnchor,
    canCreateCalendar,
    calendarDialog,
    calendarDialogBusy,
    openCreateCalendarDialog,
    openEditCalendarDialog,
    closeCalendarDialog,
    saveCalendarDialog,
    deleteCalendarFromDialog,
    surfaceEventsForView,
    askRecurrenceScope,
    recurrenceScopeDialog,
    truncateSeriesFromOccurrence,
    splitSeriesFromDrag,
  } = controller;

  const canWrite = Boolean(operations) && calendars.some((c) => c.mayWrite !== false);
  const directoryGroups = calendarDirectoryGroupsFromBootstrap(data);
  const ownerLabel = personalOwnerLabel(session);
  const myCalendars = personalCalendarsForSidebar(calendars);
  const teamCalendars = teamCalendarsForSidebar(calendars);

  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    year: L.viewYear,
  };

  useDocumentTitle(title);

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
        onRespond={(id, status, calendarId) => void invitations.respond(id, status, calendarId)}
        onOpenEvent={canWrite ? openEditEventKey : undefined}
      />
    ),
    [
      L,
      calendars,
      canWrite,
      defaultCalendarId,
      invitations.busy,
      inviteeNotifications,
      invitations.respond,
      locale,
      openEditEventKey,
      useInvitationsDrawer,
    ],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn("calendar-workspace", className)}
        sidebar={
          <AppSidebar
            open={sidebarOpen}
            onCloseMobile={() => setSidebarOpen(false)}
            primaryButton={
              canWrite ? (
                <Button
                  label={L.newEvent}
                  icon={<Plus />}
                  onClick={() => {
                    openCreateEvent();
                    closeSidebarOnMobile(() => setSidebarOpen(false));
                  }}
                  size="lg"
                  pill
                  variant="primary"
                  className="w-full"
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
            <SidebarSection
              title={L.myCalendarsSection}
              onAdd={canCreateCalendar ? openCreateCalendarDialog : undefined}
              addLabel={L.newCalendar}
            >
              <CalendarSidebarRows
                calendars={myCalendars}
                hiddenCalendarIds={hiddenCalendarIds}
                defaultCalendarId={defaultCalendarId}
                canDeleteCalendars={Boolean(operations?.deleteCalendar)}
                editLabel={L.editCalendar}
                onToggleVisibility={toggleCalendarVisibility}
                onSelectDefault={selectDefaultCalendar}
                onEdit={openEditCalendarDialog}
              />
            </SidebarSection>
            {teamCalendars.length > 0 ? (
              <SidebarSection title={L.teamCalendarsSection}>
                <CalendarSidebarRows
                  calendars={teamCalendars}
                  hiddenCalendarIds={hiddenCalendarIds}
                  defaultCalendarId={defaultCalendarId}
                  canDeleteCalendars={Boolean(operations?.deleteCalendar)}
                  editLabel={L.editCalendar}
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
            title={title}
            layout="responsive"
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            titleLeading={
              <div className="calendar-header-nav">
                <IconButton
                  label={L.previousPeriod}
                  icon={<ChevronLeft className="size-4" />}
                  onClick={goPrevious}
                />
                <IconButton
                  label={L.nextPeriod}
                  icon={<ChevronRight className="size-4" />}
                  onClick={goNext}
                />
              </div>
            }
            actions={
              <div className="calendar-header-actions">
                <Select value={view} onValueChange={(next) => selectView(next as CalendarViewId)}>
                  <SelectTrigger className="calendar-view-select" aria-label={L.viewSelectLabel}>
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
                />
                <Button label={L.today} onClick={goToday} variant="subtle" />
                <CalendarInvitationsTrigger
                  count={pendingInvitationCount(inviteeNotifications)}
                  open={invitationsOpen}
                  labels={L}
                  onToggle={toggleInvitationsOpen}
                />
              </div>
            }
          />
        }
        main={
          <div className="calendar-main" data-view={view}>
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
                onEventSelected={canWrite ? openEditEventKey : undefined}
                onViewChange={selectView}
                onStartDateChange={setAnchor}
                onCreateRequested={canWrite ? openCreateFromSurface : undefined}
                pendingCreateIntent={
                  editor?.mode === "create" ? formToCreateIntent(editor.form) : null
                }
              />
            </div>
          </div>
        }
        panel={
          useInvitationsDrawer ? undefined : (
            <div
              className="workspace-app-layout__panel calendar-workspace__invitations-panel"
              data-open={invitationsOpen ? "true" : "false"}
              aria-hidden={!invitationsOpen}
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
          sessionEmail={organizerAddress(session.user)?.email}
          onRsvp={
            editor.mode === "edit"
              ? (status, calendarId) => {
                  const notification = inviteeNotifications.find(
                    (row) => row.eventId === editor.eventId,
                  );
                  const id = notification?.id ?? editor.eventId;
                  void invitations
                    .respond(id, status, calendarId)
                    .then(() => closeEditor())
                    .catch(() => undefined);
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
        onClose={closeCalendarDialog}
        onConfirm={saveCalendarDialog}
        onDelete={
          calendarDialog?.mode === "edit" && calendarDialog.mayDelete
            ? deleteCalendarFromDialog
            : undefined
        }
      />
      <CalendarRecurrenceScopeDialog dialog={recurrenceScopeDialog} labels={L} />
    </TooltipProvider>
  );
}
