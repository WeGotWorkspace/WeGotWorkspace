import { expect, test } from "./helpers/live-test";
import {
  cleanUpCase,
  openTasksTab,
  openUser,
  OWNER,
  serverState,
  setTabOffline,
  shownLists,
  shownTitles,
  showAllTasks,
  tabCache,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #1624: Import tasks reads an `.ics` file into a new list. The tasks reach a
 * second open tab without a reload, sit in the offline cache of the importing
 * tab, the menu item is disabled offline, and a repeat import reports every
 * task as already in the list.
 */

const SYNC_BOUND_MS = 20_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

async function chooseFile(tab: Tab, name: string, body: string) {
  await tab.getByRole("button", { name: "More create options" }).click();
  await tab.getByRole("menuitem", { name: "Import tasks" }).click();
  await tab
    .locator('[data-testid="tasks-ics-file-input"]')
    .setInputFiles({ name, mimeType: "text/calendar", buffer: Buffer.from(body) });
}

test("importing an ICS file creates a list that syncs, caches and survives a re-import", async ({
  browser,
}) => {
  const id = `ics${Date.now().toString(36)}`;
  const first = `first ${id}`;
  const second = `second ${id}`;
  const listName = `L ${id}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wgw e2e//EN",
    "BEGIN:VTODO",
    `UID:${id}-1@e2e.test`,
    "DTSTAMP:20260101T000000Z",
    `SUMMARY:${first}`,
    "END:VTODO",
    "BEGIN:VTODO",
    `UID:${id}-2@e2e.test`,
    "DTSTAMP:20260101T000000Z",
    `SUMMARY:${second}`,
    "END:VTODO",
    "BEGIN:VEVENT",
    `UID:${id}-3@e2e.test`,
    "DTSTAMP:20260101T000000Z",
    "DTSTART:20260102T090000Z",
    `SUMMARY:event ${id}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  const ics = lines.join("\r\n");
  const events: string[] = [];
  const context = await openUser(browser, OWNER);

  try {
    const a = await openTasksTab(context, "a", events);
    const b = await openTasksTab(context, "b", events);
    await showAllTasks(a);
    await showAllTasks(b);

    await chooseFile(a, `${listName}.ics`, ics);
    const dialog = a.getByRole("dialog", { name: "Import tasks" });
    await dialog.getByRole("button", { name: /^Destination list/ }).click();
    await a.getByRole("menuitem", { name: "New list" }).click();
    await expect(dialog.getByRole("textbox", { name: "List name" })).toHaveValue(listName);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();

    await expect(dialog.getByText("Imported 2 tasks")).toBeVisible();
    await expect(dialog.getByText("1 event was skipped. Import it in Calendar.")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => shownLists(a, id)).toEqual([listName]);
    await expect.poll(() => shownTitles(a, id)).toEqual([first, second].sort());

    // Tab B sees the list and both tasks without a reload.
    await expect.poll(() => shownLists(b, id), { timeout: SYNC_BOUND_MS }).toEqual([listName]);
    await showAllTasks(b);
    await expect
      .poll(() => shownTitles(b, id), { timeout: SYNC_BOUND_MS })
      .toEqual([first, second].sort());

    // Tab A's offline cache holds both tasks, none pending.
    await expect
      .poll(async () => (await tabCache(a, id)).tasks.map((t) => t.title).sort())
      .toEqual([first, second].sort());
    expect((await tabCache(a, id)).tasks.every((t) => !t.pending)).toBe(true);

    // Offline: the cache still shows the tasks and Import is disabled.
    await a.reload();
    await showAllTasks(a);
    await setTabOffline(a, true);
    await expect.poll(() => shownTitles(a, id)).toEqual([first, second].sort());
    await a.getByRole("button", { name: "More create options" }).click();
    const item = a.getByRole("menuitem", { name: /Import tasks/ });
    await expect(item).toBeDisabled();
    await expect(item).toContainText("Needs an internet connection");
    await a.keyboard.press("Escape");

    // Online again: importing the same file into the same list adds nothing.
    await setTabOffline(a, false);
    await chooseFile(a, `${listName}.ics`, ics);
    await dialog.getByRole("button", { name: /^Destination list/ }).click();
    await a.getByRole("menuitem", { name: listName }).click();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog.getByText("No tasks were imported.")).toBeVisible();
    await expect(dialog.getByText("Already in this list")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Done" }).click();

    const state = await serverState(id);
    expect(state.lists.map((l) => l.name)).toEqual([listName]);
    expect(state.tasks.map((t) => t.title).sort()).toEqual([first, second].sort());
  } finally {
    await context.close();
    await cleanUpCase(id);
  }
});
