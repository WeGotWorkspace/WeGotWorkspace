import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import type {
  CalendarAPIOperations,
  CalendarDirectoryGroup,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarRouteState } from "@/calendar-core/src/calendar-route-search";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";

export type CalendarWorkspaceProps = {
  data: CalendarUIData;
  session: WorkspaceSession;
  labels?: Partial<CalendarUILabels>;
  operations?: CalendarAPIOperations;
  /** Adapter-backed store for the lit views; omitted = read-only empty surface. */
  surface?: CalendarSurfaceStore;
  initialView?: CalendarViewId;
  initialPresentation?: CalendarPresentation;
  initialAnchor?: string;
  onViewChange?: (view: CalendarViewId) => void;
  onRouteStateChange?: (state: CalendarRouteState, options?: { replace?: boolean }) => void;
  onLogout?: () => void;
  className?: string;
  /** Event ids with unsynced local writes; drives the pending-sync mark. */
  pendingEventIds?: ReadonlySet<string>;
  /** Meet reserve / room-status — injected by CalendarApp, not the calendar controller. */
  meetOperations?: CalendarMeetOperations;
  /** Configured workspace origin for guest/join equality. */
  workspaceOrigin?: string;
  /** App-owned Join navigation (new-window Meet or new-tab https). */
  onJoinMeeting?: (href: string) => void;
};

export function calendarDirectoryGroupsFromBootstrap(
  data: CalendarUIData,
): CalendarDirectoryGroup[] {
  return data.groups ?? [];
}

export function mapCalendarDirectoryGroups(
  groups: { id: string; displayName: string }[],
): CalendarDirectoryGroup[] {
  return groups.map((group) => {
    const prefix = "principals/groups/";
    const slug = group.id.startsWith(prefix) ? group.id.slice(prefix.length) : group.id;
    return {
      slug,
      displayName: group.displayName?.trim() || slug,
    };
  });
}

export function personalOwnerLabel(session: WorkspaceSession): string {
  const displayName = session.user.displayName?.trim();
  if (displayName) return displayName;
  const username = session.user.username?.trim();
  if (username) return username;
  return "Me";
}
