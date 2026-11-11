import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  cleanUpCase,
  openTasksTab,
  openUser,
  OWNER,
  POLL_MS,
  serverState,
  setTabOffline,
  showAllTasks,
  shownLists,
  shownTitles,
  tabCache,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #1624: importing an `.ics` file into Tasks through the New menu.
 *
 * Tab A imports a file with two VTODOs and one VEVENT into a new list named
 * after the file. The result step reports the skipped event. Tab B, open on
 * the same account, gets the list and both tasks without a reload. Tab A's
 * offline cache holds both tasks, and the menu item is disabled while
 * offline. Importing the same file again imports nothing and names each task
 * as already in the list.
 *
 * A second case goes offline with the dialog open on a new list: Import is
 * disabled with the reason, and no list is made, then or after a reload.
 */

/** The import's mutation event reaches another tab on push, or at the latest on the next poll. */
const OTHER_TAB_BOUND_MS = POLL_MS + 5_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("an ICS file imports into a new list and reaches a second tab", async ({ browser }) => {
  const id = `ics${Date.now().toString(36)}`;
  const listName = `import ${id}`;
  const titles = [`first ${id}`, `second ${id}`].sort();
  const file = {
    name: `${listName}.ics`,
    mimeType: "text/calendar",
    buffer: Buffer.from(icsFile(id, titles)),
  };
  const events: string[] = [];
  let context: BrowserContext | null = null;

  try {
    context = await openUser(browser, OWNER);
    const a = await openTasksTab(context, "A", events);
    const b = await openTasksTab(context, "B", events);
    await showAllTasks(b);

    // Import into a new list named after the file.
    await chooseFile(a, file);
    const dialog = a.getByRole("dialog", { name: "Import tasks" });
    await dialog.getByRole("button", { name: /^Destination list:/ }).click();
    await a.getByRole("menuitem", { name: "New list" }).click();
    await expect(dialog.getByLabel("List name")).toHaveValue(listName);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    // The skipped event keeps the dialog on its result step.
    const result = dialog.getByRole("status");
    await expect(result).toContainText("Imported 2 tasks");
    await expect(dialog.getByRole("region", { name: "Good to know" })).toContainText(
      "1 event was skipped. Import it in Calendar.",
    );
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => shownLists(a, id)).toEqual([listName]);
    await expect(a.getByRole("heading", { level: 2, name: listName })).toBeVisible();
    await expect.poll(() => shownTitles(a, id)).toEqual(titles);

    // Tab B sees the list and both tasks without a reload.
    await expect.poll(() => shownLists(b, id), { timeout: OTHER_TAB_BOUND_MS }).toEqual([listName]);
    await expect.poll(() => shownTitles(b, id), { timeout: OTHER_TAB_BOUND_MS }).toEqual(titles);

    // Both tasks are in tab A's offline cache, already synced.
    await expect
      .poll(async () => {
        const cache = await tabCache(a, id);
        return cache.tasks.map((task) => `${task.title} pending=${task.pending}`).sort();
      })
      .toEqual(titles.map((title) => `${title} pending=false`));

    // After a reload the list and tasks come back.
    await a.reload();
    await showAllTasks(a);
    await expect.poll(() => shownTitles(a, id)).toEqual(titles);

    // Offline, the item is disabled with a reason and opens no file picker.
    await setTabOffline(a, true);
    await a.getByRole("button", { name: "More create options" }).click();
    const item = a.getByRole("menuitem", { name: /Import tasks/ });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toContainText("Needs an internet connection");
    const chooser = a.waitForEvent("filechooser", { timeout: 1_500 }).catch(() => null);
    await item.click({ force: true });
    expect(await chooser).toBeNull();
    await a.keyboard.press("Escape");
    await setTabOffline(a, false);

    // The same file again, from the list in view: nothing new, each task named.
    await a
      .getByRole("region", { name: "My lists" })
      .getByRole("button", { name: listName })
      .click();
    await expect(a.getByRole("heading", { level: 2, name: listName })).toBeVisible();
    await chooseFile(a, file);
    await expect(
      dialog.getByRole("button", { name: `Destination list: ${listName}` }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(result).toContainText("No tasks imported");
    const notImported = dialog.getByRole("region", { name: "Not imported (2)" });
    for (const title of titles) {
      await expect(notImported.getByRole("row").filter({ hasText: title })).toContainText(
        "Already in this list",
      );
    }
    await dialog.getByRole("button", { name: "Done" }).click();

    const server = await serverState(id);
    expect(server.lists.map((list) => list.name)).toEqual([listName]);
    expect(server.tasks.map((task) => task.title).sort()).toEqual(titles);
    expect(events.filter((event) => !isExpected(event))).toEqual([]);
  } finally {
    await context?.close();
    await cleanUpCase(id);
  }
});

test("offline with the dialog open: Import is disabled and no list is made", async ({
  browser,
}) => {
  const id = `icsoff${Date.now().toString(36)}`;
  const listName = `offline ${id}`;
  const file = {
    name: `${listName}.ics`,
    mimeType: "text/calendar",
    buffer: Buffer.from(icsFile(id, [`only ${id}`])),
  };
  const events: string[] = [];
  let context: BrowserContext | null = null;

  try {
    context = await openUser(browser, OWNER);
    const a = await openTasksTab(context, "A", events);

    await chooseFile(a, file);
    const dialog = a.getByRole("dialog", { name: "Import tasks" });
    await dialog.getByRole("button", { name: /^Destination list:/ }).click();
    await a.getByRole("menuitem", { name: "New list" }).click();
    await expect(dialog.getByLabel("List name")).toHaveValue(listName);

    await setTabOffline(a, true);
    const submit = dialog.getByRole("button", { name: "Import", exact: true });
    await expect(submit).toBeDisabled();
    await expect(dialog).toContainText("Importing tasks needs an internet connection");
    await submit.click({ force: true }).catch(() => undefined);

    await setTabOffline(a, false);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await a.reload();
    await showAllTasks(a);
    expect(await shownLists(a, id)).toEqual([]);

    const server = await serverState(id);
    expect(server.lists).toEqual([]);
    expect(events.filter((event) => !isExpected(event))).toEqual([]);
  } finally {
    await context?.close();
    await cleanUpCase(id);
  }
});

/** Open the New menu, choose Import tasks and hand the file to its picker. */
async function chooseFile(
  tab: Tab,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await tab.getByRole("button", { name: "More create options" }).click();
  const chooser = tab.waitForEvent("filechooser");
  await tab.getByRole("menuitem", { name: "Import tasks" }).click();
  await (await chooser).setFiles(file);
  await expect(tab.getByRole("dialog", { name: "Import tasks" })).toBeVisible();
}

/** Two VTODOs and one VEVENT, with UIDs unique to the run. */
function icsFile(id: string, titles: string[]): string {
  const todos = titles.map((title, index) =>
    [
      "BEGIN:VTODO",
      `UID:${id}-task-${index}@e2e.test`,
      "DTSTAMP:20261110T000000Z",
      `SUMMARY:${title}`,
      "STATUS:NEEDS-ACTION",
      "END:VTODO",
    ].join("\r\n"),
  );
  const event = [
    "BEGIN:VEVENT",
    `UID:${id}-event@e2e.test`,
    "DTSTAMP:20261110T000000Z",
    "DTSTART:20261120T090000Z",
    "DTEND:20261120T100000Z",
    `SUMMARY:event ${id}`,
    "END:VEVENT",
  ].join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WGW e2e//Tasks import//EN",
    ...todos,
    event,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/**
 * Noise the spec causes on purpose: the second import answers 400 by design,
 * and going offline cuts open requests (push stream, probes) in both tabs.
 * Page errors and any other API error still fail the spec.
 */
function isExpected(event: string): boolean {
  return (
    /^A 400: POST \/api\/v1\/tasks\/items\/import/.test(event) ||
    /console: Failed to load resource: the server responded with a status of 400/.test(event) ||
    /console: Failed to load resource: net::ERR_INTERNET_DISCONNECTED/.test(event) ||
    / request failed:/.test(event)
  );
}
