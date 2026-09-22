import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { MOCK_CALENDAR_ANCHOR } from "@/lib/api/mock/calendar-bootstrap";
import { createSeededCalendarAppBootstrap } from "@/lib/api/mock/calendar-seed";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import {
  calendarStaticSurfaceFor,
  calendarStoryOperations,
} from "@/calendar-core/stories/calendar-story-shared";

const seeded = createSeededCalendarAppBootstrap();
const seededSurface = calendarStaticSurfaceFor(seeded);

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
    operations: calendarStoryOperations,
  },
};
