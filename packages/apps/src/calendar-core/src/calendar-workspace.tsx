import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
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
import { CalendarSurface } from "@/calendar-core/src/calendar-surface";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import "./calendar-workspace.css";

const VIEW_ORDER: CalendarViewId[] = ["month", "week", "day", "year", "agenda"];

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
    visibleCalendarIds,
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
  } = controller;

  const canWrite = Boolean(operations) && calendars.some((c) => c.mayWrite !== false);

  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    year: L.viewYear,
    agenda: L.viewAgenda,
  };

  const calendarItems: MenuItemProps[] = calendars.map((calendar) => ({
    label: calendar.name,
    icon: (
      <span
        className="calendar-sidebar-dot"
        data-hidden={hiddenCalendarIds.has(calendar.id) || undefined}
        style={{ backgroundColor: calendar.color }}
        aria-hidden
      />
    ),
    checked: !hiddenCalendarIds.has(calendar.id),
    onClick: () => toggleCalendarVisibility(calendar.id),
  }));

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
            <SidebarSection title={L.calendarsSection} items={calendarItems} />
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
              events={surface?.events ?? new Map()}
              visibleCalendarIds={[...visibleCalendarIds]}
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
    </TooltipProvider>
  );
}
