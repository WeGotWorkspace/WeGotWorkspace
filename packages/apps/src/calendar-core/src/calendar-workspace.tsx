import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/document-title";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import { CalendarCalendarDialog } from "@/calendar-core/src/calendar-calendar-dialog";
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import "./calendar-workspace.css";

/** Day → Year by time span, then List (agenda) — common calendar UI order. */
const VIEW_ORDER: CalendarViewId[] = ["day", "week", "month", "year", "agenda"];

function closeSidebarOnMobile(close: () => void) {
  if (!isSidebarOverlayViewport()) return;
  close();
}

export function CalendarWorkspace({
  data,
  session,
  labels,
  operations,
  surface,
  listRefreshing = false,
  onRefreshList,
  initialView,
  initialAnchor,
  onViewChange,
  onLogout,
  className,
}: CalendarWorkspaceProps) {
  const controller = useCalendarController({
    data,
    labels,
    operations,
    initialView,
    initialAnchor,
    onViewChange,
    surfaceEvents: surface?.events,
    resolveEventId: surface?.resolveJmapId,
    onMutated: () => {
      surface?.syncNow();
      onRefreshList?.();
    },
  });

  const {
    L,
    locale,
    view,
    selectView,
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
  } = controller;

  const canWrite = Boolean(operations) && calendars.some((c) => c.mayWrite !== false);

  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    year: L.viewYear,
    agenda: L.viewAgenda,
  };

  const calendarItems: MenuItemProps[] = calendars.map((calendar) => {
    const visible = !hiddenCalendarIds.has(calendar.id);
    const mayEdit = calendar.mayWrite !== false;
    const mayDelete = calendar.mayDelete !== false && Boolean(operations?.deleteCalendar);
    const canManage = mayEdit || mayDelete;

    return {
      label: calendar.name,
      icon: (
        <span
          className="calendar-sidebar-visibility"
          role="checkbox"
          aria-checked={visible}
          aria-label={`${visible ? "Hide" : "Show"} ${calendar.name}`}
          tabIndex={0}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleCalendarVisibility(calendar.id);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            toggleCalendarVisibility(calendar.id);
          }}
        >
          <span
            className="calendar-sidebar-dot"
            data-hidden={visible ? undefined : "true"}
            style={{ backgroundColor: calendar.color }}
            aria-hidden
          />
        </span>
      ),
      badge: canManage ? (
        <span
          className="calendar-sidebar-overflow"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={L.editCalendar}
                icon={<MoreHorizontal className="size-3.5" aria-hidden />}
                size="xs"
                variant="ghost"
                className="calendar-sidebar-overflow__button"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                onSelect={() => {
                  openEditCalendarDialog(calendar.id);
                }}
              >
                {L.editCalendar}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : undefined,
      selected: calendar.id === defaultCalendarId,
      onClick: () => selectDefaultCalendar(calendar.id),
    };
  });

  useDocumentTitle(`${L.appTitle} — ${title}`);

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
              title={L.calendarsSection}
              items={calendarItems}
              onAdd={canCreateCalendar ? openCreateCalendarDialog : undefined}
              addLabel={L.newCalendar}
            />
          </AppSidebar>
        }
        mainHeader={
          <ViewHeader
            title={title}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
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
                <IconButton
                  label={L.previousPeriod}
                  icon={<ChevronLeft className="size-4" />}
                  onClick={goPrevious}
                />
                <Button label={L.today} onClick={goToday} variant="subtle" />
                <IconButton
                  label={L.nextPeriod}
                  icon={<ChevronRight className="size-4" />}
                  onClick={goNext}
                />
                {onRefreshList ? (
                  <IconButton
                    label={L.refreshList}
                    icon={
                      <RefreshCw className={listRefreshing ? "size-4 animate-spin" : "size-4"} />
                    }
                    onClick={onRefreshList}
                    disabled={listRefreshing}
                  />
                ) : null}
              </div>
            }
          />
        }
        main={
          <div className="calendar-main" data-view={view}>
            <CalendarSurface
              view={litSurface.view}
              presentation={litSurface.presentation}
              startDate={anchor}
              events={surfaceEventsForView ?? surface?.events ?? new Map()}
              visibleCalendarIds={[...visibleCalendarIds]}
              selectedCalendarId={defaultCalendarId}
              contextValue={surface?.contextValue}
              onEventSelected={canWrite ? openEditEventKey : undefined}
              onViewChange={selectView}
              onStartDateChange={setAnchor}
              onCreateRequested={canWrite ? openCreateFromSurface : undefined}
            />
          </div>
        }
      />
      {editor ? (
        <CalendarEventDialog
          open
          mode={editor.mode}
          form={editor.form}
          calendars={calendars}
          labels={L}
          locale={locale}
          busy={editorBusy}
          onChange={setEditorForm}
          onClose={closeEditor}
          onSave={saveEditor}
          onDelete={editor.mode === "edit" ? deleteEditorEvent : undefined}
        />
      ) : null}
      <CalendarCalendarDialog
        dialog={calendarDialog}
        labels={L}
        busy={calendarDialogBusy}
        onClose={closeCalendarDialog}
        onConfirm={saveCalendarDialog}
        onDelete={
          calendarDialog?.mode === "edit" && calendarDialog.mayDelete
            ? deleteCalendarFromDialog
            : undefined
        }
      />
    </TooltipProvider>
  );
}
