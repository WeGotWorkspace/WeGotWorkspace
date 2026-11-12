import { Temporal } from "@js-temporal/polyfill";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
} from "@/lib/api/mock/calendar-bootstrap";
import { createSeededCalendarAppBootstrap } from "@/lib/api/mock/calendar-seed";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarWorkspace } from "@/calendar-core/src/calendar-workspace";
import { createCalendarTaskDueOverlayFixture } from "@/calendar-core/src/calendar-task-due-overlay-fixture";
import {
  createTeamAvailabilityFixture,
  seedMockTeamAvailability,
} from "@/calendar-core/src/calendar-availability-fixture";
import { teamAvailabilitySourceFromJmap } from "@/calendar-core/src/use-team-availability";
import { JmapClient, MockJmapServer, type JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarStaticSurfaceFor,
  calendarStoryOperations,
} from "@/calendar-core/stories/calendar-story-shared";

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

const meta: Meta<typeof CalendarWorkspace> = {
  title: "Features/Calendar",
  component: CalendarWorkspace,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    operations: calendarStoryOperations,
  },
};

export default meta;
type Story = StoryObj<typeof CalendarWorkspace>;

const bootstrap = createCalendarAppBootstrap();
const seeded = createSeededCalendarAppBootstrap();

const staticSurface = calendarStaticSurfaceFor(bootstrap);
const seededSurface = calendarStaticSurfaceFor(seeded);
const overrideBootstrap = bootstrapWithThisInstanceOverride();
const overrideSurface = calendarStaticSurfaceFor(overrideBootstrap);

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

/** Chrome Default lives under Themes/Calendar — sidebar subscription / sharee SST. */
export const SeededMonthSidebar: Story = {
  name: "Seeded month sidebar",
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
    expectGridHeader(canvasElement);
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

    // My calendars: an All row first (show/hide all), and a title that folds.
    const mine = sidebarSection(canvasElement, defaultCalendarLabels.myCalendarsSection);
    const hideAll = within(mine).getByRole("checkbox", {
      name: defaultCalendarLabels.myCalendarsHideAll,
    });
    await expect(hideAll).toHaveAttribute("aria-checked", "true");
    await userEvent.click(hideAll);
    const showAll = within(mine).getByRole("checkbox", {
      name: defaultCalendarLabels.myCalendarsShowAll,
    });
    await expect(showAll).toHaveAttribute("aria-checked", "false");
    await userEvent.click(within(mine).getByRole("checkbox", { name: "Show Personal" }));
    await expect(showAll).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(showAll);
    await expect(
      within(mine).getByRole("checkbox", { name: defaultCalendarLabels.myCalendarsHideAll }),
    ).toHaveAttribute("aria-checked", "true");
    // The title folds the section.
    const fold = within(mine).getByRole("button", {
      name: defaultCalendarLabels.myCalendarsSection,
    });
    await userEvent.click(fold);
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(within(mine).queryByText("Personal")).toBeNull();
    await userEvent.click(fold);
    await expect(within(mine).getByText("Personal")).toBeTruthy();
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

/** An event with unsynced local writes: blue pending-sync dot on its calendar's sidebar row. */
export const PendingSync: Story = {
  name: "Pending sync",
  tags: ["vitest-ci"],
  args: {
    ...bootstrap,
    surface: staticSurface,
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
    pendingEventIds: new Set(["standup"]),
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        canvasElement.querySelector(
          `.calendar-sidebar-row__pending-sync[aria-label="${defaultCalendarLabels.pendingSync}"]`,
        ),
      ).toBeTruthy(),
    );
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

const taskDueOverlayBootstrap = createCalendarTaskDueOverlayFixture();
const taskDueOverlayArgs = {
  ...bootstrap,
  surface: staticSurface,
  taskDueBootstrap: taskDueOverlayBootstrap,
  initialAnchor: MOCK_CALENDAR_ANCHOR,
  onOpenTaskInTasks: () => {},
};

function sidebarSection(root: HTMLElement, title: string): HTMLElement {
  const heading = within(root).getByRole("heading", { name: title });
  const section = heading.closest(".sidebar-section");
  if (!(section instanceof HTMLElement)) {
    throw new Error(`sidebar section "${title}" not found`);
  }
  return section;
}

export const TaskDueOverlayWeek: Story = {
  tags: ["vitest-ci"],
  args: {
    ...taskDueOverlayArgs,
    initialView: "week",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: defaultCalendarLabels.tasksSection }),
    ).toBeTruthy();
    await expect(
      canvas.getByRole("heading", { name: defaultCalendarLabels.sharedTaskListsSection }),
    ).toBeTruthy();
    const tasksSection = sidebarSection(canvasElement, defaultCalendarLabels.tasksSection);
    await expect(within(tasksSection).getByText("Personal")).toBeTruthy();
    await expect(within(tasksSection).getByText("Work")).toBeTruthy();
    await waitFor(() => {
      const summaries = collectEventCardSummaries(canvasElement);
      if (!summaries.includes("Buy milk") || !summaries.includes("Review API spec")) {
        throw new Error("task due overlay cards not ready");
      }
    });
    await userEvent.click(within(tasksSection).getByRole("checkbox", { name: "Hide Work" }));
    await waitFor(() => {
      const summaries = collectEventCardSummaries(canvasElement);
      expect(summaries).toContain("Buy milk");
      expect(summaries).not.toContain("Review API spec");
    });

    // The heading's dot: half-filled while only some lists show; it shows all.
    const showAll = within(tasksSection).getByRole("checkbox", {
      name: defaultCalendarLabels.tasksSectionShowAll,
    });
    await expect(showAll).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(showAll);
    await waitFor(() =>
      expect(collectEventCardSummaries(canvasElement)).toContain("Review API spec"),
    );
    await userEvent.click(
      within(tasksSection).getByRole("checkbox", {
        name: defaultCalendarLabels.tasksSectionHideAll,
      }),
    );
    await waitFor(() => {
      const summaries = collectEventCardSummaries(canvasElement);
      expect(summaries).not.toContain("Buy milk");
      expect(summaries).not.toContain("Review API spec");
    });

    // The title folds the section, its All row included; unfolding brings both back.
    const fold = within(tasksSection).getByRole("button", {
      name: defaultCalendarLabels.tasksSection,
    });
    await userEvent.click(fold);
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(within(tasksSection).queryByText("Personal")).toBeNull();
    await expect(
      within(tasksSection).queryByRole("checkbox", {
        name: defaultCalendarLabels.tasksSectionShowAll,
      }),
    ).toBeNull();
    await userEvent.click(fold);
    await expect(within(tasksSection).getByText("Personal")).toBeTruthy();
    await userEvent.click(
      within(tasksSection).getByRole("checkbox", {
        name: defaultCalendarLabels.tasksSectionShowAll,
      }),
    );
    await waitFor(() => expect(collectEventCardSummaries(canvasElement)).toContain("Buy milk"));
  },
};

const teamAvailabilityArgs = {
  ...bootstrap,
  surface: staticSurface,
  initialAnchor: MOCK_CALENDAR_ANCHOR,
  initialView: "week" as const,
};

/** Team availability (#1910): own row plus two teammates, Ada and Grace ticked. */
export const TeamAvailabilityThree: Story = {
  tags: ["vitest-ci"],
  args: {
    ...teamAvailabilityArgs,
    availabilityPreset: {
      ...createTeamAvailabilityFixture({ count: 3, anchor: MOCK_CALENDAR_ANCHOR }),
      shownIds: ["ada", "grace"],
    },
  },
  play: async ({ canvasElement }) => {
    const section = sidebarSection(canvasElement, defaultCalendarLabels.teamAvailabilitySection);
    // The All row comes first, then one row per person.
    const rows = within(within(section).getByRole("list")).getAllByRole("checkbox");
    await expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      defaultCalendarLabels.teamAvailabilityShowAll,
      "Show your own availability",
      "Hide Ada Lovelace's availability",
      "Hide Grace Hopper's availability",
    ]);
    await expect(within(section).queryByRole("searchbox")).toBeNull();

    // The heading's dot: mixed while some are on, then shows and hides everyone.
    const all = within(section).getByRole("checkbox", {
      name: defaultCalendarLabels.teamAvailabilityShowAll,
    });
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(all);
    await waitFor(() =>
      expect(
        within(section).getByRole("checkbox", { name: "Hide your own availability" }),
      ).toBeTruthy(),
    );
    await userEvent.click(
      within(section).getByRole("checkbox", {
        name: defaultCalendarLabels.teamAvailabilityHideAll,
      }),
    );
    await waitFor(() =>
      expect(
        within(section).getByRole("checkbox", {
          name: defaultCalendarLabels.teamAvailabilityShowAll,
        }),
      ).toHaveAttribute("aria-checked", "false"),
    );
  },
};

/** Twelve rows: the filter shows; Alan's weeks came back incomplete. */
export const TeamAvailabilityTwelve: Story = {
  tags: ["vitest-ci"],
  args: {
    ...teamAvailabilityArgs,
    availabilityPreset: {
      ...createTeamAvailabilityFixture({ count: 12, anchor: MOCK_CALENDAR_ANCHOR }),
      shownIds: ["ada", "grace", "alan"],
    },
  },
  play: async ({ canvasElement }) => {
    const section = sidebarSection(canvasElement, defaultCalendarLabels.teamAvailabilitySection);
    // Twelve people plus the All row, which the filter leaves in place.
    const list = within(section).getByRole("list");
    await expect(within(list).getAllByRole("checkbox")).toHaveLength(13);
    await expect(
      within(section).getByRole("img", { name: defaultCalendarLabels.teamAvailabilityIncomplete }),
    ).toBeTruthy();
    await userEvent.type(
      within(section).getByRole("searchbox", {
        name: defaultCalendarLabels.teamAvailabilityFilter,
      }),
      "gr",
    );
    await waitFor(() => expect(within(list).getAllByRole("checkbox")).toHaveLength(2));
  },
};

/** Rows start hidden: nothing ticked, nothing on the grid. */
export const TeamAvailabilityHiddenByDefault: Story = {
  args: {
    ...teamAvailabilityArgs,
    availabilityPreset: {
      ...createTeamAvailabilityFixture({ count: 3, anchor: MOCK_CALENDAR_ANCHOR }),
      shownIds: [],
    },
  },
};

/** Offline in a month view whose later weeks were never fetched. */
export const TeamAvailabilityOffline: Story = {
  tags: ["vitest-ci"],
  args: {
    ...teamAvailabilityArgs,
    initialView: "month",
    availabilityPreset: {
      ...createTeamAvailabilityFixture({
        count: 3,
        anchor: MOCK_CALENDAR_ANCHOR,
        cachedWeeksAfter: 1,
        fetchedAt: Date.now() - 2 * 60 * 60 * 1000,
      }),
      shownIds: ["ada", "grace"],
      offline: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByRole("region", { name: defaultCalendarLabels.calendarNoticeBarLabel });
    await expect(bar.textContent).toContain(
      "Offline · teammates' availability updated 2 hours ago.",
    );
    await expect(bar.textContent).toContain(defaultCalendarLabels.teamAvailabilityOfflineUncached);
  },
};

/** Busy blocks in a month (#1911): Ada shares details, Grace only busy times. */
export const TeamAvailabilityBusyMonth: Story = {
  args: {
    ...teamAvailabilityArgs,
    initialView: "month",
    availabilityPreset: {
      ...createTeamAvailabilityFixture({ count: 3, anchor: MOCK_CALENDAR_ANCHOR }),
      shownIds: ["ada", "grace"],
    },
  },
};

function findBusyCard(root: ParentNode, summary: string): HTMLElement | null {
  for (const el of root.querySelectorAll('event-card[data-overlay="availability"]')) {
    if ((el as HTMLElement & { summary?: string }).summary === summary) return el as HTMLElement;
  }
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const found = findBusyCard(el.shadowRoot, summary);
      if (found) return found;
    }
  }
  return null;
}

/** Clicking a busy block opens its read-only popover: person, title, time, location. */
export const TeamAvailabilityBusyPopover: Story = {
  tags: ["vitest-ci"],
  args: {
    ...teamAvailabilityArgs,
    availabilityPreset: {
      ...createTeamAvailabilityFixture({ count: 3, anchor: MOCK_CALENDAR_ANCHOR }),
      shownIds: ["ada", "grace"],
    },
  },
  play: async ({ canvasElement }) => {
    const card = await waitFor(() => {
      const found = findBusyCard(canvasElement, "Roadmap review");
      if (!found) throw new Error("busy card not ready");
      return found;
    });
    await userEvent.click(card);
    const popover = await waitFor(() => {
      const found = canvasElement.ownerDocument.querySelector(".calendar-availability-popover");
      if (!(found instanceof HTMLElement)) throw new Error("popover not open");
      return found;
    });
    await expect(popover.textContent).toContain("Ada Lovelace");
    await expect(popover.textContent).toContain("Roadmap review");
    await expect(popover.textContent).toContain("Room Babbage");
  },
};

/** A JMAP server with the contract's TeamMember methods behind the section. */
function mockTeamAvailabilitySource() {
  const server = new MockJmapServer();
  seedMockTeamAvailability(
    server.availability,
    createTeamAvailabilityFixture({
      count: 12,
      anchor: MOCK_CALENDAR_ANCHOR,
      cachedWeeksBefore: 26,
      cachedWeeksAfter: 26,
    }),
  );
  return teamAvailabilitySourceFromJmap(
    new JmapClient({ sessionUrl: server.sessionUrl, fetch: server.fetch }),
  );
}

/**
 * The live path against the mock JMAP server: ticks, fetches, the Dexie cache
 * and the device prefs all run, so ticked rows and cached weeks survive a reload.
 */
export const TeamAvailabilityMockServer: Story = {
  args: {
    ...teamAvailabilityArgs,
    session: {
      ...bootstrap.session,
      user: { ...bootstrap.session.user, username: "me", displayName: "Morgan Reed" },
    },
    availabilitySource: mockTeamAvailabilitySource(),
  },
};

export const TaskDueOverlayDay: Story = {
  args: {
    ...taskDueOverlayArgs,
    initialView: "day",
  },
};

export const TaskDueOverlayMonth: Story = {
  args: {
    ...taskDueOverlayArgs,
    initialView: "month",
  },
};

export const TaskDueOverlayList: Story = {
  args: {
    ...taskDueOverlayArgs,
    initialView: "week",
    initialPresentation: "list",
  },
};

export const TaskDueOverlayYear: Story = {
  args: {
    ...taskDueOverlayArgs,
    initialView: "year",
  },
  play: async ({ canvasElement }) => {
    const day12 = await waitFor(() => {
      const view = queryDeep(canvasElement, "calendar-timeline-view");
      const cards = [...(view?.shadowRoot?.querySelectorAll(".month-card") ?? [])];
      const january = cards.find((card) =>
        card.querySelector(".month-title")?.textContent?.includes("January"),
      );
      const button = [...(january?.querySelectorAll("button.year-day") ?? [])].find(
        (el) =>
          el.querySelector(".year-day-number")?.textContent?.includes("12") &&
          !el.classList.contains("is-outside-month"),
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("January 12 year day not ready");
      }
      return button;
    });
    expect(day12.querySelectorAll(".year-day-dot").length).toBeLessThanOrEqual(3);
    expect(day12.querySelectorAll(".year-day-dot").length).toBeGreaterThan(0);
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
    surface: calendarStaticSurfaceFor({ ...seeded, data }),
    initialAnchor: browseDate.toString(),
    initialView: "week" as const,
    // Search lives in list mode (the floating bar over the list).
    initialPresentation: "list" as const,
  };
}

const searchBootstrap = searchStoryBootstrap();

function calendarSearchField(root: HTMLElement): HTMLInputElement {
  return within(root).getByPlaceholderText(
    defaultCalendarLabels.searchPlaceholder,
  ) as HTMLInputElement;
}

/** List mode's one search field: the header's floating bar over the list. */
function expectOneSearchField(root: HTMLElement) {
  expect(
    root.querySelectorAll(`input[aria-label="${defaultCalendarLabels.searchPlaceholder}"]`),
  ).toHaveLength(1);
  expect(calendarSearchField(root).closest(".view-header__search-stack")).toBeTruthy();
}

/** The grid's header: no search (it lives in list mode), the view menu before ‹ ›. */
function expectGridHeader(root: HTMLElement) {
  expect(within(root).queryByPlaceholderText(defaultCalendarLabels.searchPlaceholder)).toBeNull();
  const nav = root.querySelector(".calendar-header-nav");
  if (!(nav instanceof HTMLElement)) throw new Error("header nav not found");
  const [viewMode, ...arrows] = within(nav).getAllByRole("button");
  expect(viewMode?.getAttribute("aria-label")).toMatch(/^View mode:/);
  expect(arrows).toHaveLength(2);
}

/**
 * While search shows results the range rests: the title is "Search" without its menu
 * (views, Today), and the view menu and ‹ › are disabled.
 */
function expectRangeControls(root: HTMLElement, enabled: boolean) {
  expect(Boolean(root.querySelector(".view-header__title-menu"))).toBe(enabled);
  const nav = root.querySelector(".calendar-header-nav");
  if (!(nav instanceof HTMLElement)) throw new Error("header nav not found");
  for (const button of within(nav).getAllByRole("button")) {
    expect((button as HTMLButtonElement).disabled).toBe(!enabled);
  }
}

/** The search result rows, in order. */
function searchRows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".calendar-search-results [data-list-item-id]")];
}

function searchRowTitles(root: HTMLElement): string[] {
  return searchRows(root).map(
    (row) => row.querySelector(".list-item__title")?.textContent?.trim() ?? "",
  );
}

/**
 * Hydrated `?q=` fills the field without stealing focus (WCAG 2.4.3 / 3.2.1).
 * `/` and ⌘/Ctrl+K select the current value.
 */
export const SearchFromUrl: Story = {
  tags: ["vitest-ci"],
  args: {
    ...searchBootstrap,
    initialSearchQuery: "client call",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = calendarSearchField(canvasElement);
    expectOneSearchField(canvasElement);
    await expect(input).toHaveValue("client call");
    await expect(input).not.toHaveFocus();
    await expect(
      canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeTruthy();
    await waitFor(() => expect(searchRowTitles(canvasElement)).toContain("Client call"));
    expectRangeControls(canvasElement, false);
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
    expectOneSearchField(canvasElement);
    await expect(input).not.toHaveFocus();
    expectRangeControls(canvasElement, true);
    // Idle: the period's list, not search results.
    await expect(canvasElement.querySelector(".calendar-event-list")).toBeTruthy();
    await expect(canvasElement.querySelector(".calendar-search-results")).toBeNull();
    await expect(
      canvas.queryByRole("heading", { name: defaultCalendarLabels.searchTitle }),
    ).toBeNull();
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
    input.blur();
    await expect(input).not.toHaveFocus();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect(input).toHaveFocus();
  },
};

/** Phone width: the same one field; Escape clears it and lets go of focus. */
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
    expectOneSearchField(canvasElement);
    await userEvent.keyboard("/");
    await expect(input).toHaveFocus();
    await userEvent.type(input, "verg");
    await userEvent.keyboard("{Escape}");
    await expect(input).toHaveValue("");
    await expect(input).not.toHaveFocus();
  },
};

/** Tablet / mid-width: the same one field. */
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
    expectOneSearchField(canvasElement);
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
    await expect(calendarSearchField(canvasElement)).toHaveValue("sprint");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
        expect(searchRowTitles(canvasElement)).toContain("Sprint retro");
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
    await userEvent.type(calendarSearchField(canvasElement), "client call");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
        expect(canvasElement.querySelectorAll(".calendar-search-results")).toHaveLength(1);
        expect(canvas.queryByRole("heading", { name: "Upcoming" })).toBeNull();
        expect(canvas.queryByRole("heading", { name: "Past" })).toBeNull();
      },
      { timeout: 3000 },
    );
    expectRangeControls(canvasElement, false);
    await expect(searchRowTitles(canvasElement)).toContain("Client call");
  },
};

export const SearchNoMatch: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    await userEvent.type(calendarSearchField(canvasElement), "zzzz-no-such-event");
    await waitFor(
      () => {
        const results = canvasElement.querySelector(".calendar-search-results--empty");
        const state = results?.querySelector(".collection-state");
        if (!(state instanceof HTMLElement) || !(results instanceof HTMLElement)) {
          throw new Error("search empty state not ready");
        }
        expect(state.querySelector(".collection-state__body")?.textContent).toBe(
          defaultCalendarLabels.searchNoMatch,
        );
        expectHorizontallyCentered(state, results);
      },
      { timeout: 3000 },
    );
    // No scope tags (searched range, calendars) above the results.
    await expect(canvasElement.querySelector(".calendar-search-results .tag")).toBeNull();
    await expect(
      within(canvasElement).queryByText(defaultCalendarLabels.noEventsInRange),
    ).toBeNull();
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
        expect(canvasElement.querySelector(".calendar-search-results .tag")).toBeNull();
        const rows = searchRows(canvasElement);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(100);
        // Results span years: the day headings carry the year.
        expect(canvasElement.querySelector(".calendar-search-results")?.textContent).toMatch(
          /\d{4}/,
        );
      },
      { timeout: 4000 },
    );
  },
};

/** A result opens in the detail pane beside the results; the query stays. */
export const SearchResultOpen: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    await userEvent.type(calendarSearchField(canvasElement), "client call");
    const row = await waitFor(() => {
      const first = searchRows(canvasElement)[0];
      if (!first) throw new Error("search result row not ready");
      return first;
    });
    await userEvent.click(row.querySelector(".list-item__title") ?? row);
    await waitFor(() => {
      const pane = canvasElement.querySelector(".calendar-event-pane");
      expect(pane).toBeTruthy();
      expect(
        within(pane as HTMLElement).getByLabelText(defaultCalendarLabels.eventTitleLabel),
      ).toHaveValue("Client call");
    });
    await expect(canvasElement.querySelector(".calendar-search-results")).toBeTruthy();
    await expect(calendarSearchField(canvasElement)).toHaveValue("client call");
  },
};

export const SearchTypingBurst: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expectRangeControls(canvasElement, true);
    await userEvent.type(calendarSearchField(canvasElement), "client call");
    await waitFor(
      () => {
        expect(
          canvas.getByRole("heading", { name: defaultCalendarLabels.searchTitle }),
        ).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expectRangeControls(canvasElement, false);
  },
};

export const SearchClearImmediate: Story = {
  tags: ["vitest-ci"],
  args: searchBootstrap,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(calendarSearchField(canvasElement), "verg");
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", { name: "Clear search" }),
    );
    const idle = async () => {
      await expect(
        canvas.queryByRole("heading", { name: defaultCalendarLabels.searchTitle }),
      ).toBeNull();
      expectRangeControls(canvasElement, true);
      await expect(canvasElement.querySelector(".calendar-event-list")).toBeTruthy();
    };
    await idle();
    // A late debounce must not bring the results back.
    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });
    await idle();
  },
};

function expectHorizontallyCentered(state: HTMLElement, view: HTMLElement) {
  const stateBox = state.getBoundingClientRect();
  const viewBox = view.getBoundingClientRect();
  const stateMid = stateBox.left + stateBox.width / 2;
  const viewMid = viewBox.left + viewBox.width / 2;
  expect(Math.abs(stateMid - viewMid)).toBeLessThanOrEqual(2);
}

export const Empty: Story = {
  tags: ["vitest-ci"],
  args: {
    data: { calendars: bootstrap.data.calendars, events: [] },
    session: bootstrap.session,
    surface: {
      events: new Map(),
      contextValue: undefined,
      syncNow: () => {},
      resolveJmapId: async () => undefined,
    },
    initialAnchor: MOCK_CALENDAR_ANCHOR,
    initialView: "month",
    initialPresentation: "list",
  },
  play: async ({ canvasElement }) => {
    // List mode: the empty period's list states it, centred in the list pane.
    await waitFor(() => {
      const view = canvasElement.querySelector(".calendar-event-list--empty");
      const state = view?.querySelector(".collection-state");
      if (!(state instanceof HTMLElement) || !(view instanceof HTMLElement)) {
        throw new Error("list empty state not ready");
      }
      expect(state.querySelector(".collection-state__body")?.textContent).toBe(
        defaultCalendarLabels.noEventsInRange,
      );
      expectHorizontallyCentered(state, view);
      expect(state.querySelector(".collection-state__icon")).toBeTruthy();
    });
  },
};
