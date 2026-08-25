import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
} from "@/lib/api/mock/calendar-bootstrap";
import { createMockCalendarIcsOperations } from "@/lib/api/mock/calendar-ics-operations";
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

function collectEventCardSummaries(root: ParentNode): string[] {
  const summaries: string[] = [];
  const visit = (node: ParentNode) => {
    for (const el of node.querySelectorAll("event-card")) {
      const summary = (el as HTMLElement & { summary?: string }).summary;
      if (typeof summary === "string") summaries.push(summary);
    }
    for (const el of node.querySelectorAll("*")) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return summaries;
}

function bootstrapWithThisInstanceOverride() {
  const base = createCalendarAppBootstrap();
  return {
    ...base,
    data: {
      ...base.data,
      events: base.data.events.map((event) =>
        event.id === "standup"
          ? {
              ...event,
              recurrenceOverrides: {
                "2033-01-10T09:30:00": {
                  title: "Team standup (moved)",
                  start: "2033-01-10T11:00:00",
                },
              },
            }
          : event,
      ),
    },
  };
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
  patchCalendar: async (calendarId, patch) => ({
    id: calendarId,
    name: patch.name ?? "Calendar",
    color: patch.color ?? "#6366f1",
  }),
  deleteCalendar: async () => {},
  ...createMockCalendarIcsOperations(),
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
const overrideBootstrap = bootstrapWithThisInstanceOverride();
const overrideSurface = staticSurfaceFor(overrideBootstrap);

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
    await expect(canvasElement.querySelector(".calendar-sidebar-row__share")).toBeNull();
    await expect(
      personal?.closest(".calendar-sidebar-row")?.querySelector(".calendar-sidebar-row__edit"),
    ).toBeTruthy();
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Share calendar" })).toBeNull();
    await expect(
      canvas.getByRole("heading", { name: defaultCalendarLabels.sharedWithMeSection }),
    ).toBeTruthy();
    await expect(
      canvas.queryByRole("heading", { name: defaultCalendarLabels.subscribedCalendarsSection }),
    ).toBeNull();
    const family = [...canvasElement.querySelectorAll(".calendar-sidebar-row__name")].find(
      (el) => el.textContent === "Family",
    );
    await expect(
      family
        ?.closest(".calendar-sidebar-row__title")
        ?.querySelector(".calendar-sidebar-row__readonly")
        ?.getAttribute("aria-label"),
    ).toBe(defaultCalendarLabels.viewOnlyCalendarBadge);
    await expect(
      family?.closest(".calendar-sidebar-row")?.querySelector(".calendar-sidebar-row__edit"),
    ).toBeTruthy();
    const editorial = [...canvasElement.querySelectorAll(".calendar-sidebar-row__name")].find(
      (el) => el.textContent === "Editorial",
    );
    await expect(
      editorial
        ?.closest(".calendar-sidebar-row__title")
        ?.querySelector(".calendar-sidebar-row__team"),
    ).toBeNull();
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

export const ThisInstanceOverride: Story = {
  tags: ["vitest-ci"],
  args: {
    ...overrideBootstrap,
    surface: overrideSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "week",
  },
  play: async ({ canvasElement }) => {
    const summaries = await waitFor(() => {
      const next = collectEventCardSummaries(canvasElement);
      if (!next.includes("Team standup (moved)")) {
        throw new Error("override event-card not ready");
      }
      return next;
    });
    await expect(summaries.filter((title) => title === "Team standup (moved)")).toHaveLength(1);
    await expect(summaries.filter((title) => title === "Team standup")).toHaveLength(0);
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
