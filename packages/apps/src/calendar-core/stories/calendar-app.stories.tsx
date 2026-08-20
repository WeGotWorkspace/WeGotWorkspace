import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
} from "@/lib/api/mock/calendar-bootstrap";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";

function queryDeep(root: ParentNode, selector: string): Element | null {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const found = queryDeep(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

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

/**
 * Deterministic read-only surface for stories: same lit views, no adapter
 * (the mock route and live app run the MockJmapServer/JMAP-backed adapter
 * with full drag interactivity).
 */
const staticSurface: CalendarSurfaceStore = {
  events: calendarEventsToEngineMap(bootstrap.data.events, {
    sessionEmail: bootstrap.session.user.email,
  }),
  contextValue: undefined,
  syncNow: () => {},
};

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
  },
};

export const ListPresentation: Story = {
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
    initialPresentation: "list",
  },
};

export const Week: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "week",
  },
};

export const Day: Story = {
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: "2033-01-12",
    initialView: "day",
  },
};

export const Year: Story = {
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "year",
  },
};

export const Empty: Story = {
  args: {
    data: { calendars: bootstrap.data.calendars, events: [] },
    session: bootstrap.session,
    surface: { events: new Map(), contextValue: undefined, syncNow: () => {} },
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
    initialPresentation: "list",
  },
  play: async ({ canvasElement }) => {
    await expect
      .poll(() => queryDeep(canvasElement, ".collection-state__body")?.textContent)
      .toBe(defaultCalendarLabels.noEventsInRange);
    await expect(queryDeep(canvasElement, ".collection-state__icon")).toBeTruthy();
  },
};
