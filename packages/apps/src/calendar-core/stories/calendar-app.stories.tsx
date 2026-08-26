import { Temporal } from "@js-temporal/polyfill";
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
import { CALENDAR_SEARCH_SECTION_CAP } from "@/calendar-core/src/calendar-search";
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

const TABLET_SEARCH_VIEWPORT = {
  name: "Tablet search 820",
  styles: { width: "820px", height: "1180px" },
  type: "tablet" as const,
};

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...seeded,
    surface: seededSurface,
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
    expectSearchLeftOfViewSelect(canvasElement);
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
    expectSearchLeftOfViewSelect(canvasElement);
    expectNoSearchChrome(canvasElement);
  },
};

/** Official `DevCalendarEventCatalog` full profile (~360 events) at desktop month width. */
export const SeededWide: Story = {
  args: {
    ...seeded,
    surface: seededSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Mock-tier port of `DevCalendarEventCatalog` PROFILE_FULL at desktop width so wide month cells show slimmer interactive cards (more than three titles) before +N.",
      },
    },
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

function searchStoryEvent(
  id: string,
  title: string,
  start: string,
  extra: Partial<JmapCalendarEvent> = {},
): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: `urn:uuid:${id}`,
    calendarIds: { work: true },
    title,
    start,
    duration: "PT1H",
    timeZone: "Etc/UTC",
    ...extra,
  } as JmapCalendarEvent;
}

function searchStoryBootstrap(extraEvents: JmapCalendarEvent[] = []) {
  const today = Temporal.Now.plainDateISO();
  // Keep the browse week off "today" so idle / restore / result-open stories
  // do not surface the existing now-badge / Today-active contrast misses.
  const browseDate = today.add({ days: 14 });
  const upcoming = `${today.add({ days: 10 }).toString()}T10:00:00`;
  const past = `${today.subtract({ days: 10 }).toString()}T15:00:00`;
  // Full `wgw:calendars:seed-dev` catalog, dated around today so it sits
  // inside `calendarBootstrapWindow()` (the 2033 Seeded story is outside it).
  const seeded = createSeededCalendarAppBootstrap(today);
  const data = {
    ...seeded.data,
    events: [
      ...seeded.data.events,
      searchStoryEvent("search-client", "Client call", upcoming, {
        locations: { room: { "@type": "Location", name: "Room 4" } },
        description: "Bring the deck",
      }),
      searchStoryEvent(
        "search-sprint",
        "Sprint retro",
        `${today.add({ days: 10 }).toString()}T15:00:00`,
      ),
      searchStoryEvent("search-past", "Client retro", past),
      ...extraEvents,
    ],
  };
  return {
    ...seeded,
    data,
    surface: staticSurfaceFor({ ...seeded, data }),
    initialAnchor: browseDate.toString(),
    initialView: "week" as const,
  };
}

const searchBootstrap = searchStoryBootstrap();

function calendarSearchField(root: HTMLElement): HTMLElement {
  return within(root).getByPlaceholderText(defaultCalendarLabels.searchPlaceholder);
}

function expectNoSearchChrome(root: HTMLElement) {
  expect(
    within(root).queryByRole("button", { name: defaultCalendarLabels.searchPlaceholder }),
  ).toBeNull();
  expect(root.querySelector(".calendar-search-trigger")).toBeNull();
  expect(root.querySelector(".calendar-header-search")).toBeNull();
  expect(root.querySelector(".view-header__search-stack")).toBeNull();
  expect(root.ownerDocument.querySelector(".calendar-search-popover")).toBeNull();
  expect(root.querySelectorAll(".calendar-search-field")).toHaveLength(1);
  expect(
    root.querySelectorAll('input[aria-label="' + defaultCalendarLabels.searchPlaceholder + '"]'),
  ).toHaveLength(1);
}

function expectSearchLeftOfViewSelect(root: HTMLElement) {
  const field = calendarSearchField(root).closest(".calendar-search-field");
  const actions = root.querySelector(".calendar-header-actions");
  const select = actions?.querySelector(".calendar-view-select");
  expect(field).toBeTruthy();
  expect(actions?.contains(field)).toBe(true);
  expect(select).toBeTruthy();
  expect(
    Boolean(
      field &&
      select &&
      (field.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ),
  ).toBe(true);
}

/**
 * Hydrated `?q=` fills the always-visible field without stealing focus
 * (WCAG 2.4.3 / 3.2.1). `/` and ⌘/Ctrl+K select the current value.
 */
export const SearchFromUrl: Story = {
  tags: ["vitest-ci"],
  args: {
    ...searchBootstrap,
    initialSearchQuery: "client call",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement) as HTMLInputElement;
    expectNoSearchChrome(canvasElement);
    expectSearchLeftOfViewSelect(canvasElement);
    await expect(input.closest(".calendar-search-field")).toBeTruthy();
    await expect(input).toHaveValue("client call");
    await expect(input).not.toHaveFocus();
    await expect(
      canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeTruthy();
    await expect(collectEventCardSummaries(canvasElement).includes("Client call")).toBe(true);
    await expect(labeledTodayButton(canvasElement).disabled).toBe(true);
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
    await expect(input.selectionStart).toBe(0);
    await expect(input.selectionEnd).toBe("client call".length);
  },
};

export const SearchIdle: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement);
    expectNoSearchChrome(canvasElement);
    expectSearchLeftOfViewSelect(canvasElement);
    await expect(input.closest(".calendar-search-field")).toBeTruthy();
    await expect(input).not.toHaveFocus();
    await expect(labeledTodayButton(canvasElement).disabled).toBe(false);
    await expect(canvasElement.querySelector("wgw-calendar-surface")).toBeTruthy();
    await expect(
      canvas.queryByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeNull();
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
    (input as HTMLInputElement).blur();
    await expect(input).not.toHaveFocus();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect(input).toHaveFocus();
  },
};

/** Compact viewport: same mounted field, CSS-repositioned as a right-hand FAB. */
export const SearchIdleCompact: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
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
  },
  globals: {
    viewport: { value: "compactMonth", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const input = calendarSearchField(canvasElement);
    expectNoSearchChrome(canvasElement);
    expect(input.closest(".calendar-search-field")).toBeTruthy();
    expect(input.closest(".calendar-header-actions")).toBeTruthy();
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
  },
};

/** Tablet / mid-width: still the FAB (sidebar-overlay floor), not the header field. */
export const SearchIdleTablet: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  decorators: [
    (Story) => (
      <div style={{ width: 820, height: 1180, maxWidth: "100%", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    viewport: {
      options: {
        tabletSearch: TABLET_SEARCH_VIEWPORT,
      },
    },
  },
  globals: {
    viewport: { value: "tabletSearch", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const input = calendarSearchField(canvasElement);
    expectNoSearchChrome(canvasElement);
    expect(input.closest(".calendar-search-field")).toBeTruthy();
    expect(input.closest(".calendar-header-actions")).toBeTruthy();
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
  },
};

export const SearchSprintRetro: Story = {
  tags: ["vitest-ci"],
  args: {
    ...searchBootstrap,
    initialSearchQuery: "sprint",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement) as HTMLInputElement;
    await expect(input).toHaveValue("sprint");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
        const list = canvasElement.querySelector("calendar-list-view");
        const items = list?.shadowRoot?.querySelectorAll(".agenda-event-item");
        expect(items?.length).toBeGreaterThan(0);
        expect(collectEventCardSummaries(canvasElement).includes("Sprint retro")).toBe(true);
      },
      { timeout: 4000 },
    );
  },
};

export const SearchMatches: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement);
    await userEvent.type(input, "client call");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
        expect(canvasElement.querySelectorAll("calendar-list-view")).toHaveLength(1);
        expect(canvas.queryByRole("heading", { name: "Upcoming" })).toBeNull();
        expect(canvas.queryByRole("heading", { name: "Past" })).toBeNull();
      },
      { timeout: 3000 },
    );
    await expect(labeledTodayButton(canvasElement).disabled).toBe(true);
    await expect(collectEventCardSummaries(canvasElement).includes("Client call")).toBe(true);
  },
};

export const SearchNoMatch: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(calendarSearchField(canvasElement), "zzzz-no-such-event");
    await waitFor(
      () => {
        const list = canvasElement.querySelector("calendar-list-view");
        const body = list?.shadowRoot?.querySelector(".collection-state__body");
        expect(body?.textContent).toBe(defaultCalendarLabels.searchNoMatch);
      },
      { timeout: 3000 },
    );
    await expect(canvas.queryByText(/Downloaded /)).toBeNull();
    await expect(canvas.queryByText(defaultCalendarLabels.noEventsInRange)).toBeNull();
  },
};

export const SearchTruncated: Story = {
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(calendarSearchField(canvasElement), "standup");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
        expect(canvasElement.querySelector(".calendar-search-results__caption")).toBeNull();
        expect(canvas.queryByText("Showing the next 100")).toBeNull();
        expect(canvas.queryByText("Showing the most recent 100")).toBeNull();
        const list = canvasElement.querySelector("calendar-list-view");
        const items = list?.shadowRoot?.querySelectorAll(".agenda-event-item");
        expect(items?.length).toBeGreaterThan(0);
        expect(items?.length).toBeLessThanOrEqual(CALENDAR_SEARCH_SECTION_CAP * 2);
      },
      { timeout: 4000 },
    );
  },
};

export const SearchResultOpen: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    await userEvent.type(calendarSearchField(canvasElement), "client call");
    const row = await waitFor(() => {
      const list = canvasElement.querySelector("calendar-list-view");
      const item = list?.shadowRoot?.querySelector(".agenda-event-item");
      if (!(item instanceof HTMLElement)) {
        throw new Error("search result row not ready");
      }
      return item;
    });
    await userEvent.click(row);
    await waitFor(() => {
      const popover = canvasElement.ownerDocument.querySelector(".calendar-event-details-popover");
      expect(popover).toBeTruthy();
      expect(canvasElement.querySelector("calendar-list-view")).toBeTruthy();
      expect(canvasElement.querySelector("wgw-calendar-surface")).toBeNull();
      expect((calendarSearchField(canvasElement) as HTMLInputElement).value).toBe("client call");
      expect(labeledTodayButton(canvasElement).disabled).toBe(true);
      expect(popover?.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
    });
    // Modal hideOthers marks the story root aria-hidden; dismiss so afterEach
    // a11y does not scan the still-tabbable ViewHeader query under that tree.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        canvasElement.ownerDocument.querySelector(".calendar-event-details-popover"),
      ).toBeNull();
    });
  },
};

export const SearchTypingBurst: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement);
    await userEvent.type(input, "client call");
    await expect(labeledTodayButton(canvasElement).disabled).toBe(false);
    await expect(canvasElement.querySelector("wgw-calendar-surface")).toBeTruthy();
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
      },
      { timeout: 3000 },
    );
    await expect(labeledTodayButton(canvasElement).disabled).toBe(true);
  },
};

export const SearchClearImmediate: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement);
    await userEvent.type(input, "verg");
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", { name: "Clear search" }),
    );
    await expect(
      canvas.queryByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeNull();
    await expect(labeledTodayButton(canvasElement).disabled).toBe(false);
    await expect(canvasElement.querySelector("wgw-calendar-surface")).toBeTruthy();
    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });
    await expect(
      canvas.queryByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeNull();
    await expect(labeledTodayButton(canvasElement).disabled).toBe(false);
  },
};

function labeledTodayButton(root: ParentNode): HTMLButtonElement {
  const button = root.querySelector(".calendar-header-today");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("labeled Today control not found");
  }
  return button;
}

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
