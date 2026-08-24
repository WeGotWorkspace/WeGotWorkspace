import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
} from "@/lib/api/mock/calendar-bootstrap";
import { createSeededCalendarAppBootstrap } from "@/lib/api/mock/calendar-seed";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import type { CalendarSurfaceStore } from "@/calendar-core/src/use-calendar-surface";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import type { JmapCalendarEvent } from "@/lib/jmap-client";

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
  subscribeCalendar: async (draft) => ({
    id: "story-sub",
    name: draft.name ?? "Subscribed",
    color: draft.color ?? "#8b5cf6",
    subscriptionId: "sub-story",
  }),
};

const meta: Meta<typeof CalendarWorkspace> = {
  title: "Apps/Calendar",
  component: CalendarWorkspace,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    operations: storyOperations,
  },
};

export default meta;
type Story = StoryObj<typeof CalendarWorkspace>;

const bootstrap = createCalendarAppBootstrap();
const seeded = createSeededCalendarAppBootstrap();

/**
 * Deterministic read-only surface for stories: same lit views, no adapter
 * (the mock route and live app run the MockJmapServer/JMAP-backed adapter
 * with full drag interactivity).
 */
function staticSurfaceFor(data: typeof bootstrap): CalendarSurfaceStore {
  return {
    events: calendarEventsToEngineMap(data.data.events, {
      sessionEmail: data.session.user.email,
      calendars: data.data.calendars,
    }),
    contextValue: undefined,
    syncNow: () => {},
  };
}

const staticSurface = staticSurfaceFor(bootstrap);
const seededSurface = staticSurfaceFor(seeded);

const COMPACT_MONTH_VIEWPORT = {
  name: "Compact month 390",
  styles: { width: "390px", height: "844px" },
  type: "mobile" as const,
};

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
  },
  play: async ({ canvasElement }) => {
    const name = [...canvasElement.querySelectorAll(".calendar-sidebar-row__name")].find(
      (el) => el.textContent === "US Holidays",
    );
    const title = name?.closest(".calendar-sidebar-row__title");
    const mark = title?.querySelector(".calendar-sidebar-row__subscription");
    const edit = name
      ?.closest(".calendar-sidebar-row")
      ?.querySelector(".calendar-sidebar-row__edit");
    await expect(mark?.getAttribute("aria-label")).toBe(
      defaultCalendarLabels.subscribedCalendarBadge,
    );
    await expect(
      Boolean(title && name && title.contains(name) && mark && title.contains(mark)),
    ).toBe(true);
    await expect(
      !edit ||
        (mark != null &&
          (mark.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    ).toBe(true);
    const personal = [...canvasElement.querySelectorAll(".calendar-sidebar-row__name")].find(
      (el) => el.textContent === "Personal",
    );
    await expect(
      personal
        ?.closest(".calendar-sidebar-row__title")
        ?.querySelector(".calendar-sidebar-row__subscription"),
    ).toBeNull();
    await expect(canvasElement.querySelector(".sidebar-section__heading-actions")).toBeNull();
    await expect(canvasElement.querySelector(".sidebar-section__add")).toBeNull();
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: defaultCalendarLabels.newEvent })).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: defaultCalendarLabels.newEventMenu }),
    ).toBeTruthy();
  },
};

/** Official `DevCalendarEventCatalog` full profile (~360 events), compact-month width. */
export const Seeded: Story = {
  args: {
    ...seeded,
    surface: seededSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
  },
  decorators: [
    (Story) => (
      <div style={{ width: 390, height: 844, maxWidth: "100%", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    viewport: {
      options: {
        compactMonth: COMPACT_MONTH_VIEWPORT,
      },
    },
    docs: {
      description: {
        story:
          "Mock-tier port of `DevCalendarEventCatalog` PROFILE_FULL (`wgw:calendars:seed-dev`). Month view at ~390px so slim overflow bars and +N are visible. Default stays sparse for CI smoke.",
      },
    },
  },
  globals: {
    viewport: { value: "compactMonth", isRotated: false },
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
  play: async ({ canvasElement }) => {
    const timedCard = await waitFor(() => {
      const timedHost = queryDeep(canvasElement, "time-line.timeline-timed");
      const card = timedHost?.shadowRoot?.querySelector("event-card");
      if (!(card instanceof HTMLElement)) {
        throw new Error("timed event-card not ready");
      }
      return card;
    });
    await userEvent.click(timedCard);
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector(".calendar-event-details-popover"),
      ).toBeTruthy();
    });
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
