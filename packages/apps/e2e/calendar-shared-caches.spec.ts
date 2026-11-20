// Calendar on the shared offline caches (live app, #2285). An open Calendar
// week keeps the Tasks overlay current from the Tasks cache, and the invitee
// search reads the Contacts cache. Neither may download a whole app's data on
// open, focus or typing, and neither may miss a change made while its own app
// was closed. `calendarSpot` in the Tasks matrix reloads before each look, so
// it never sees a Calendar that stays open.
import { expect, test, type Request } from "./helpers/live-test";
import { CALENDAR_WEEK_DATE, openCalendarWeek } from "./helpers/calendar-live";
import { createContactCards, destroyContactCards } from "./helpers/contacts-jmap";
import {
  cleanUpCase,
  createList,
  createTask,
  openUser,
  OWNER,
  waitForTasks,
} from "./helpers/tasks-matrix";

test.describe("Calendar on shared caches (live app)", () => {
  test("a task created in Tasks shows in an open Calendar week without a reload or a bootstrap", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const caseId = `cal-shared-${Date.now()}`;
    const title = `${caseId} task`;
    const context = await openUser(browser, OWNER);
    try {
      const tasksTab = await context.newPage();
      await tasksTab.goto("/tasks");
      await waitForTasks(tasksTab as never);

      const calendarTab = await context.newPage();
      await openCalendarWeek(calendarTab, CALENDAR_WEEK_DATE);

      const list = await createList(`${caseId} list`);
      await createTask(list, title, {
        due: `${CALENDAR_WEEK_DATE}T10:00:00`,
        showWithoutTime: false,
        timeZone: "UTC",
      });

      await expect(
        calendarTab.locator("time-line.timeline-timed event-card").filter({ hasText: title }),
      ).toBeVisible({ timeout: 60_000 });

      // Focus the Calendar tab again: no full Tasks bootstrap.
      const bootstraps: string[] = [];
      const onRequest = (request: Request) => {
        if (request.method() !== "GET") return;
        const url = new URL(request.url());
        const isLists = url.pathname.endsWith("/tasks/tasklists");
        const isItems = url.pathname.endsWith("/tasks/items") && url.searchParams.has("taskListId");
        if (isLists || isItems) bootstraps.push(`${url.pathname}${url.search}`);
      };
      calendarTab.on("request", onRequest);
      await tasksTab.bringToFront();
      await calendarTab.bringToFront();
      await calendarTab.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      await calendarTab.waitForTimeout(3_000);
      calendarTab.off("request", onRequest);
      expect(bootstraps, "full Tasks bootstrap after refocus").toEqual([]);
    } finally {
      await context.close();
      await cleanUpCase(caseId);
    }
  });

  test("the invitee search finds a contact added while Contacts was closed, without a full listing", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const name = `Bob ${stamp}`;
    const context = await openUser(browser, OWNER);
    let created: string[] = [];
    try {
      // Contacts stores its cache and sync tokens, then closes.
      const contactsTab = await context.newPage();
      await contactsTab.goto("/contacts");
      await expect(contactsTab.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
        timeout: 60_000,
      });
      await contactsTab.close();

      // Another device adds the contact.
      created = await createContactCards([
        {
          "@type": "Card",
          version: "1.0",
          kind: "individual",
          addressBookIds: { default: true },
          name: { "@type": "Name", full: name },
          emails: { e1: { "@type": "EmailAddress", address: `bob${stamp}@example.test` } },
        },
      ]);

      const calendarTab = await context.newPage();
      const listings: string[] = [];
      calendarTab.on("request", (request) => {
        if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
        const body = request.postData() ?? "";
        // `listCards`: a query with the get that follows it, no ids of its own.
        if (body.includes('"ContactCard/query"')) listings.push(body.slice(0, 200));
      });
      await calendarTab.goto("/calendar");
      await expect(calendarTab.locator(".calendar-workspace")).toBeVisible({ timeout: 30_000 });
      await calendarTab.getByRole("button", { name: "New event" }).click();

      const input = calendarTab.getByLabel("Add participants");
      await input.fill("Bob");
      await expect(calendarTab.getByRole("option", { name: new RegExp(name) })).toBeVisible({
        timeout: 30_000,
      });
      expect(listings, "full ContactCard listing from Calendar").toEqual([]);
    } finally {
      await context.close();
      await destroyContactCards(created);
    }
  });
});
