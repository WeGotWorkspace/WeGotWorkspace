import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { TooltipProvider } from "@/ui/tooltip";
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
import { CalendarAgendaView } from "@/calendar-core/src/calendar-agenda-view";
import type { CalendarWorkspaceProps } from "@/calendar-core/src/calendar-workspace-props";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import "./calendar-workspace.css";

const VIEW_ORDER: CalendarViewId[] = ["month", "week", "day", "agenda"];

export function CalendarWorkspace({
  data,
  session,
  labels,
  operations,
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
  });

  const {
    L,
    view,
    selectView,
    title,
    goToday,
    goPrevious,
    goNext,
    sidebarOpen,
    setSidebarOpen,
    calendars,
    hiddenCalendarIds,
    toggleCalendarVisibility,
    occurrences,
  } = controller;

  const viewLabels: Record<CalendarViewId, string> = {
    month: L.viewMonth,
    week: L.viewWeek,
    day: L.viewDay,
    agenda: L.viewAgenda,
  };

  const viewItems: MenuItemProps[] = VIEW_ORDER.map((id) => ({
    label: viewLabels[id],
    selected: view === id,
    onClick: () => selectView(id),
  }));

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
              <Button
                label={L.today}
                icon={<CalendarDays />}
                onClick={() => {
                  goToday();
                  setSidebarOpen(false);
                }}
              />
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
            <SidebarSection title={L.viewsSection} items={viewItems} />
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
                <IconButton
                  label={L.previousPeriod}
                  icon={<ChevronLeft className="size-4" />}
                  onClick={goPrevious}
                />
                <Button label={L.today} onClick={goToday} variant="ghost" />
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
          <div className="calendar-main">
            <CalendarAgendaView occurrences={occurrences} labels={L} />
          </div>
        }
      />
    </TooltipProvider>
  );
}
