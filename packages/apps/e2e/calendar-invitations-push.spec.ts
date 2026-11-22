import { expect, test, type BrowserContext } from "./helpers/live-test";
import { CALENDAR_WEEK_DATE, openCalendarWeek } from "./helpers/calendar-live";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #2287: a new invitation reaches the invitee's open Calendar tab on push,
 * without a reload. Delivering it writes the invitee's event copy, which
 * moves the `CalendarEvent` state.
 *
 * Bound: 8 s, inside the 60 s poll that runs while push is connected.
 */

const PUSH_BOUND_MS = 8_000;
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("an invitation reaches the invitee's open Calendar tab on push", async ({ browser }) => {
  test.setTimeout(120_000);
  const title = `invite push ${Date.now().toString(36)}`;
  let context: BrowserContext | null = null;
  let calendarId: string | null = null;
  try {
    context = await openUser(browser, TEAMMATE);
    const connected = context.waitForEvent("response", {
      predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
      timeout: 30_000,
    });
    const tab = await context.newPage();
    await openCalendarWeek(tab, CALENDAR_WEEK_DATE);
    await connected;
    let navigations = 0;
    tab.on("framenavigated", (frame) => {
      if (frame === tab.mainFrame()) navigations += 1;
    });

    const badge = tab.locator(".calendar-invitations-trigger[data-count]");
    const countNow = async () =>
      Number(
        (await badge
          .first()
          .getAttribute("data-count", { timeout: 500 })
          .catch(() => null)) ?? 0,
      );
    const before = await countNow();

    const sentAt = Date.now();
    calendarId = await createCalendar(title);
    await inviteTeammate(calendarId, title);
    await expect
      .poll(countNow, {
        message: "the invitations badge count rises on push",
        timeout: Math.max(1, PUSH_BOUND_MS - (Date.now() - sentAt)),
      })
      .toBeGreaterThan(before);
    expect(navigations, "the tab never reloaded").toBe(0);
  } finally {
    await context?.close();
    if (calendarId) {
      await jmap([
        [
          "Calendar/set",
          { accountId: OWNER, destroy: [calendarId], onDestroyRemoveEvents: true },
          "d",
        ],
      ]).catch(() => undefined);
    }
  }
});

async function jmap(methodCalls: unknown[]) {
  const res = await api(OWNER, "POST", "/jmap", { using: USING, methodCalls });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json as { methodResponses: [string, Record<string, unknown>, string][] })
    .methodResponses;
}

async function createCalendar(name: string): Promise<string> {
  const [[, result]] = await jmap([
    ["Calendar/set", { accountId: OWNER, create: { c: { name, color: "#0ea5e9" } } }, "c"],
  ]);
  const created = (result as { created?: { c?: { id: string } } }).created?.c;
  if (!created) throw new Error(`Calendar not created: ${JSON.stringify(result)}`);
  return created.id;
}

async function inviteTeammate(calendarId: string, title: string): Promise<string> {
  const [[, result]] = await jmap([
    [
      "CalendarEvent/set",
      {
        accountId: OWNER,
        create: {
          e: {
            "@type": "Event",
            calendarIds: { [calendarId]: true },
            title,
            start: `${CALENDAR_WEEK_DATE}T09:00:00`,
            duration: "PT1H",
            participants: {
              invitee: {
                "@type": "Participant",
                email: TEAMMATE,
                name: TEAMMATE,
                roles: { attendee: true },
                participationStatus: "needs-action",
                expectReply: true,
              },
            },
          },
        },
      },
      "c",
    ],
  ]);
  const created = (result as { created?: { e?: { id: string } } }).created?.e;
  if (!created) throw new Error(`Event not created: ${JSON.stringify(result)}`);
  return created.id;
}
