import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { MOCK_CALENDAR_ANCHOR } from "@/lib/api/mock/calendar-bootstrap";
import { createMockCalendarIcsOperations } from "@/lib/api/mock/calendar-ics-operations";
import { createSeededCalendarAppBootstrap } from "@/lib/api/mock/calendar-seed";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import type { JmapCalendarEvent } from "@/lib/jmap-client";

const storyEvent = {
  "@type": "Event",
  id: "story-event",
  uid: "urn:uuid:story-event",
  calendarIds: { default: true },
  title: "Story",
  start: "2033-01-12T09:00:00",
  duration: "PT1H",
  timeZone: "Etc/UTC",
} as JmapCalendarEvent;

const storyOperations: CalendarAPIOperations = {
  createEvent: async () => storyEvent,
  patchEvent: async () => storyEvent,
  deleteEvent: async () => {},
  createCalendar: async (draft) => ({
    id: "story-cal",
    name: draft.name,
    color: draft.color ?? "#6366f1",
  }),
  patchCalendar: async (calendarId, patch) => ({
    id: calendarId,
    name: patch.name ?? "Calendar",
    color: patch.color ?? "#6366f1",
  }),
  deleteCalendar: async () => {},
  ...createMockCalendarIcsOperations(),
};

const seeded = createSeededCalendarAppBootstrap();

function staticSurfaceFor(data: typeof seeded): CalendarSurfaceStore {
  return {
    events: calendarEventsToEngineMap(data.data.events, {
      sessionEmail: data.session.user.email,
      calendars: data.data.calendars,
    }),
    contextValue: undefined,
    syncNow: () => {},
  };
}

const seededSurface = staticSurfaceFor(seeded);

const brandingMeta = createBrandingStoryMeta({
  appId: "calendar",
  workspaceClass: "calendar-workspace",
  accentToken: "calendar-accent",
  component: CalendarWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Calendar",
  tags: ["vitest-ci"],
} satisfies Meta<typeof CalendarWorkspace>;

export default meta;
type Story = StoryObj<typeof CalendarWorkspace>;

export const Default: Story = {
  args: {
    ...seeded,
    surface: seededSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
    operations: storyOperations,
  },
};
