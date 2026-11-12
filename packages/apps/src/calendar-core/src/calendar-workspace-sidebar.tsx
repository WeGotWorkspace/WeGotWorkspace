import type { ComponentProps } from "react";
import { CalendarDays } from "lucide-react";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarNewMenu } from "@/calendar-core/src/calendar-new-menu";
import {
  CalendarSidebarRows,
  MyCalendarsSidebarSection,
} from "@/calendar-core/src/calendar-sidebar-rows";
import {
  ownedAndTeamCalendarsForSidebar,
  sharedWithMeCalendarsForSidebar,
} from "@/calendar-core/src/calendar-sidebar-order";
import { CalendarAvailabilitySidebar } from "@/calendar-core/src/calendar-availability-sidebar";
import { CalendarRemindersSidebar } from "@/calendar-core/src/calendar-task-due-sidebar";

type CalendarRowProps = Omit<ComponentProps<typeof CalendarSidebarRows>, "calendars">;

export type CalendarWorkspaceSidebarProps = {
  L: CalendarUILabels;
  open: boolean;
  onClose: () => void;
  session: WorkspaceSession;
  onLogout?: () => void;
  calendars: readonly CalendarInfo[];
  /** Props every calendar row takes (mine and shared with me). */
  rowProps: CalendarRowProps;
  onSetVisible: (calendarIds: readonly string[], visible: boolean) => void;
  /** No writable calendar: the primary button is Today instead of New. */
  canWrite: boolean;
  onCreateEvent: () => void;
  onCreateCalendar?: () => void;
  onSubscribeCalendar?: () => void;
  onImportEvents?: () => void;
  onToday: () => void;
  availability: ComponentProps<typeof CalendarAvailabilitySidebar>["availability"];
  reminders: Omit<ComponentProps<typeof CalendarRemindersSidebar>, "labels">;
};

/**
 * The calendar's sidebar: New (or Today without a writable calendar), my calendars,
 * those shared with me, team availability and reminders. A pick closes it on phones.
 */
export function CalendarWorkspaceSidebar({
  L,
  open,
  onClose,
  session,
  onLogout,
  calendars,
  rowProps,
  onSetVisible,
  canWrite,
  onCreateEvent,
  onCreateCalendar,
  onSubscribeCalendar,
  onImportEvents,
  onToday,
  availability,
  reminders,
}: CalendarWorkspaceSidebarProps) {
  /** Runs `action`, then closes the sidebar where it overlays the page. */
  const thenDismiss = (action: () => void) => () => {
    action();
    dismissSidebarOverlay(onClose);
  };
  const sharedWithMe = sharedWithMeCalendarsForSidebar([...calendars]);
  return (
    <AppSidebar
      settingsAppId="calendar"
      open={open}
      onCloseMobile={onClose}
      primaryButton={
        canWrite ? (
          <CalendarNewMenu
            labels={L}
            onCreateEvent={thenDismiss(onCreateEvent)}
            onCreateCalendar={onCreateCalendar && thenDismiss(onCreateCalendar)}
            onSubscribeCalendar={onSubscribeCalendar && thenDismiss(onSubscribeCalendar)}
            onImportEvents={onImportEvents && thenDismiss(onImportEvents)}
          />
        ) : (
          <SidebarSegmentedNewMenu
            mainLabel={L.today}
            menuLabel={L.newEventMenu}
            icon={<CalendarDays />}
            onMainAction={thenDismiss(onToday)}
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
        rowProps={{ calendars: ownedAndTeamCalendarsForSidebar([...calendars]), ...rowProps }}
        onSetVisible={onSetVisible}
        labels={L}
      />
      {sharedWithMe.length > 0 ? (
        <SidebarSection title={L.sharedWithMeSection}>
          <CalendarSidebarRows calendars={sharedWithMe} {...rowProps} />
        </SidebarSection>
      ) : null}
      <CalendarAvailabilitySidebar availability={availability} labels={L} />
      <CalendarRemindersSidebar {...reminders} labels={L} />
    </AppSidebar>
  );
}
