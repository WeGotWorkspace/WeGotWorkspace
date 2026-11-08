import { expect, test } from "./helpers/live-test";
import {
  expectCalendarOffline,
  expectCalendarOnline,
  navigateCalendarInApp,
  openCalendarWeek,
} from "./helpers/calendar-live";
import { api, OWNER, TEAMMATE } from "./helpers/live-matrix";

/** A far-future week, so install seeds and the prefetch window stay out of it. */
const WEEK = "2033-01-12";
const TEAM = { slug: "e2e-availability-team", displayName: "E2E availability" };

type JmapResponses = { methodResponses: [string, Record<string, unknown>][] };

async function jmap(user: string, using: string[], methodCalls: unknown[]) {
  const res = await api(user, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", ...using],
    methodCalls,
  });
  expect(res.status, `JMAP as ${user}`).toBe(200);
  return (res.json as JmapResponses).methodResponses;
}

/** The teammate's display name, as the sidebar shows it. */
async function teammateName(): Promise<string> {
  const [[, result]] = await jmap(
    OWNER,
    ["urn:wgw:jmap:availability"],
    [["TeamMember/get", { accountId: OWNER, ids: [TEAMMATE] }, "m"]],
  );
  const list = (result.list ?? []) as { id: string; name: string }[];
  const member = list.find((entry) => entry.id === TEAMMATE);
  expect(member, `${TEAMMATE} listed for ${OWNER}`).toBeTruthy();
  return member!.name;
}

async function createTeammateEvent(title: string): Promise<string> {
  const [[, calendars]] = await jmap(
    TEAMMATE,
    ["urn:ietf:params:jmap:calendars"],
    [["Calendar/get", { accountId: TEAMMATE, ids: null }, "c"]],
  );
  const list = (calendars.list ?? []) as { id: string; isDefault?: boolean }[];
  const calendar = list.find((entry) => entry.isDefault) ?? list[0];
  expect(calendar, `${TEAMMATE} has a calendar`).toBeTruthy();
  const [[, set]] = await jmap(
    TEAMMATE,
    ["urn:ietf:params:jmap:calendars"],
    [
      [
        "CalendarEvent/set",
        {
          accountId: TEAMMATE,
          create: {
            e1: {
              "@type": "Event",
              calendarIds: { [calendar!.id]: true },
              title,
              start: `${WEEK}T10:00:00`,
              duration: "PT1H",
              timeZone: "Europe/Amsterdam",
            },
          },
        },
        "s",
      ],
    ],
  );
  const created = (set.created ?? {}) as Record<string, { id: string }>;
  expect(created.e1, `event created: ${JSON.stringify(set)}`).toBeTruthy();
  return created.e1!.id;
}

async function destroyTeammateEvent(id: string): Promise<void> {
  await jmap(
    TEAMMATE,
    ["urn:ietf:params:jmap:calendars"],
    [["CalendarEvent/set", { accountId: TEAMMATE, destroy: [id] }, "d"]],
  );
}

test.describe("Calendar team availability offline (live app)", () => {
  test("a ticked teammate's busy time stays offline, with a notice that says how old it is", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const title = `e2e-busy-${Date.now()}`;

    // Setup: a shared Team, the teammate shares "Time only", and has one event that week.
    await api(OWNER, "POST", "/admin/groups", TEAM);
    for (const user of [OWNER, TEAMMATE]) {
      await api(OWNER, "PUT", `/admin/groups/${TEAM.slug}/members/${user}`);
    }
    const sharing = await api(TEAMMATE, "PUT", "/calendars/availability", { enabled: true });
    expect(sharing.status).toBe(200);
    const eventId = await createTeammateEvent(title);

    try {
      const name = await teammateName();
      const busyBlocks = page.locator('event-card[data-overlay="availability"]');
      const notices = page.getByRole("region", { name: "Calendar notices" });

      await openCalendarWeek(page, WEEK);
      await expect(page.getByRole("heading", { name: "Team availability" })).toBeVisible();
      const row = page.getByRole("checkbox", { name: `Show ${name}'s availability` });
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("aria-checked", "false");
      await expect(busyBlocks).toHaveCount(0);

      // Tick: a Busy block at the event's time; "Time only" keeps the title out.
      await row.click();
      await expect(busyBlocks.first()).toBeVisible({ timeout: 20_000 });
      await expect(busyBlocks.first()).toContainText("Busy");
      await expect(page.locator("event-card").filter({ hasText: title })).toHaveCount(0);

      // Offline: the block stays, and the notice says when the data was fetched.
      await page.context().setOffline(true);
      await expectCalendarOffline(page);
      await expect(busyBlocks.first()).toBeVisible();
      await expect(notices).toContainText("Offline · teammates' availability updated");

      // Still offline, the month spans the fetched weeks and weeks never fetched.
      await navigateCalendarInApp(page, `/calendar/month/${WEEK}`);
      await expect(notices).toContainText("Some weeks in view are not available offline.");

      // A week with nothing cached.
      await navigateCalendarInApp(page, "/calendar/week/2033-03-16");
      await expect(notices).toContainText(
        "teammates' availability for this period is not available offline.",
      );

      // Back online, the notice goes away.
      await page.context().setOffline(false);
      await expectCalendarOnline(page);
      await expect(page.getByText("teammates' availability")).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await destroyTeammateEvent(eventId);
      await api(TEAMMATE, "PUT", "/calendars/availability", { enabled: false });
      await api(OWNER, "DELETE", `/admin/groups/${TEAM.slug}`);
    }
  });
});
