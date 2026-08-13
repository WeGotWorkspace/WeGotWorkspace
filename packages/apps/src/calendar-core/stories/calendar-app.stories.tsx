import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
} from "@/lib/api/mock/calendar-bootstrap";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";

const meta: Meta<typeof CalendarWorkspace> = {
  title: "Apps/Calendar",
  component: CalendarWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof CalendarWorkspace>;

const bootstrap = createCalendarAppBootstrap();

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
  },
};

export const Agenda: Story = {
  args: {
    ...bootstrap,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "agenda",
  },
};

export const Week: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "week",
  },
};

export const Day: Story = {
  args: {
    ...bootstrap,
    initialAnchor: "2033-01-12",
    initialView: "day",
  },
};

export const Empty: Story = {
  args: {
    data: { calendars: bootstrap.data.calendars, events: [] },
    session: bootstrap.session,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "agenda",
  },
};
