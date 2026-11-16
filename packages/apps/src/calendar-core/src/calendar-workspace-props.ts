import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import type {
  CalendarAPIOperations,
  CalendarDirectoryGroup,
  CalendarPresentation,
  CalendarUIData,
  CalendarViewId,
} from "@/lib/models/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarRouteState } from "@/calendar-core/src/calendar-route-search";
import type { CalendarMeetOperations } from "@/lib/meetings/calendar-meet-link";
import type { TasksUIData } from "@/lib/models/tasks-types";
import type {
  TeamAvailabilityPreset,
  TeamAvailabilitySource,
} from "@/calendar-core/src/use-team-availability";

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
  initialSearchQuery?: string;
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
  /** Story/test Tasks overlay fixture. Omitted in live Calendar — hydrate from Dexie/hybrid. */
  taskDueBootstrap?: TasksUIData;
  /** App-owned navigation to `/tasks/lists/{listId}?task=`. */
  onOpenTaskInTasks?: (href: string) => void;
  /** `TeamMember/*` for the Team availability section (#1910); omitted = no section. */
  availabilitySource?: TeamAvailabilitySource | null;
  /** Story/test fixture for Team availability — skips Dexie and the network. */
  availabilityPreset?: TeamAvailabilityPreset;
};

export function calendarDirectoryGroupsFromBootstrap(
  data: CalendarUIData,
): CalendarDirectoryGroup[] {
  return data.groups ?? [];
}

export function personalOwnerLabel(session: WorkspaceSession): string {
  const displayName = session.user.displayName?.trim();
  if (displayName) return displayName;
  const username = session.user.username?.trim();
  if (username) return username;
  return "Me";
}
