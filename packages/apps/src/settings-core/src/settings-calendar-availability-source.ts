import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { createMockCalendarAvailabilitySettingsOperations } from "@/lib/api/mock/calendar-availability-settings";
import {
  createWgwCalendarAvailabilitySettingsOperations,
  type CalendarAvailabilitySettingsOperations,
} from "@/lib/api/wgw/calendar-availability";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";

let mockOperations: CalendarAvailabilitySettingsOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise, so Save survives navigation. */
export function defaultCalendarAvailabilitySettingsOperations(): CalendarAvailabilitySettingsOperations {
  return createWorkspaceSource<CalendarAvailabilitySettingsOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwCalendarAvailabilitySettingsOperations,
    createMockSource: () => (mockOperations ??= createMockCalendarAvailabilitySettingsOperations()),
  });
}

type CalendarAvailabilitySavedMessage = { type: "calendar-availability-saved" };

function isSavedMessage(value: unknown): value is CalendarAvailabilitySavedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "calendar-availability-saved"
  );
}

/** A Save in one tab tells the other open tabs to re-read (there is no push for settings). */
export const calendarAvailabilitySavedTopic = crossTabTopic(
  "wgw.settings.calendar-availability",
  isSavedMessage,
);
