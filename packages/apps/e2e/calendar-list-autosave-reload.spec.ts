import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER } from "./helpers/live-matrix";

/**
 * List mode's detail pane saves as you type. A reload within the save delay must not
 * lose the edit: the page sends it on its way out, the reloaded tab shows it, a second
 * tab on the same account gets it on push, and the API has it.
 */

const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("an event title typed just before a reload is saved", async ({ browser }) => {
  test.setTimeout(150_000);
  const id = `reload${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(5);
  const before = `Autosave ${id}`;
  const after = `Renamed ${id}`;
  const calendarId = await createCalendar(`Autosave ${id}`);
  const contexts: BrowserContext[] = [];

  try {
    const eventId = await createEvent(calendarId, before, date);

    const second = await openUser(browser, OWNER);
    contexts.push(second);
    const connected = pushConnected(second);
    const b = await openListWeek(second, date, before);
    await connected;
    let navigations = 0;
    b.on("framenavigated", (frame) => {
      if (frame === b.mainFrame()) navigations += 1;
    });

    const first = await openUser(browser, OWNER);
    contexts.push(first);
    const a = await openListWeek(first, date, before);
    await row(a, before).click();
    const title = a.locator(".calendar-event-pane").getByPlaceholder("Add title");
    await expect(title).toHaveValue(before);

    const sent = a.waitForRequest((request) => (request.postData() ?? "").includes(after), {
      timeout: 15_000,
    });
    await title.fill(after);
    // Within the save delay: the autosave timer has not fired yet.
    await a.reload();
    await sent;

    await expect(row(a, after)).toBeVisible({ timeout: 30_000 });
    await expect(row(b, after)).toBeVisible({ timeout: 15_000 });
    expect(navigations, "the second tab never reloaded").toBe(0);
    await expect.poll(() => serverTitle(eventId), { timeout: 15_000 }).toBe(after);
  } finally {
    for (const context of contexts) await context.close();
    await jmap([["Calendar/set", { accountId: OWNER, destroy: [calendarId] }, "d"]]).catch(
      () => undefined,
    );
  }
});

function row(page: Page, title: string) {
  return page.locator(".list-item__title", { hasText: title }).first();
}

async function openListWeek(context: BrowserContext, date: string, title: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/calendar/list/week/${date}`);
  await expect(row(page, title)).toBeVisible({ timeout: 30_000 });
  return page;
}

/** A Wednesday inside the calendar's loaded window. */
function wednesdayWeeksAhead(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7 + ((3 - date.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type MethodResponse = [string, Record<string, unknown>, string];

async function jmap(methodCalls: unknown[]): Promise<MethodResponse[]> {
  const res = await api(OWNER, "POST", "/jmap", { using: USING, methodCalls });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json as { methodResponses: MethodResponse[] }).methodResponses;
}

async function createCalendar(name: string): Promise<string> {
  const [[, result]] = await jmap([
    ["Calendar/set", { accountId: OWNER, create: { c: { name, color: "#0ea5e9" } } }, "c"],
  ]);
  const created = (result as { created?: { c?: { id: string } } }).created?.c;
  if (!created) throw new Error(`Calendar not created: ${JSON.stringify(result)}`);
  return created.id;
}

async function createEvent(calendarId: string, title: string, date: string): Promise<string> {
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
            start: `${date}T10:00:00`,
            duration: "PT1H",
          },
        },
      },
      "e",
    ],
  ]);
  const created = (result as { created?: { e?: { id: string } } }).created?.e;
  if (!created) throw new Error(`Event not created: ${JSON.stringify(result)}`);
  return created.id;
}

async function serverTitle(eventId: string): Promise<string | undefined> {
  const [[, result]] = await jmap([
    ["CalendarEvent/get", { accountId: OWNER, ids: [eventId], properties: ["title"] }, "g"],
  ]);
  return (result as { list?: { title?: string }[] }).list?.[0]?.title;
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
