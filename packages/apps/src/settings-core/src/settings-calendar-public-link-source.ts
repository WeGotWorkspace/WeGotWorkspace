import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { createMockCalendarAvailabilityPublicLinkOperations } from "@/lib/api/mock/calendar-availability-public-link";
import {
  createWgwCalendarAvailabilityPublicLinkOperations,
  type CalendarAvailabilityPublicLinkOperations,
} from "@/lib/api/wgw/calendar-availability-public-link";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";

let mockOperations: CalendarAvailabilityPublicLinkOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise, so the link survives navigation. */
export function defaultCalendarAvailabilityPublicLinkOperations(): CalendarAvailabilityPublicLinkOperations {
  return createWorkspaceSource<CalendarAvailabilityPublicLinkOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwCalendarAvailabilityPublicLinkOperations,
    createMockSource: mocksInBuild
      ? () => (mockOperations ??= createMockCalendarAvailabilityPublicLinkOperations())
      : mocksNotInBuild,
  });
}
