// A task create the browser reports as failed although the server stored it
// (live app and API, #2155).
//
// Safari reports a quick-add POST that a reload cut off as failed, although
// the server already stored the task. The outbox then sends the create again
// after the reload. Here Chromium gets the same treatment: the POST reaches
// the server, and the page gets a network error instead of the answer. The
// resend carries the UID of the first send, so the server answers with the
// task it already has and the list shows it once.
import { expect, test } from "./helpers/live-test";
import {
  cleanUpCase,
  createList,
  openTasksTab,
  openUser,
  OWNER,
  serverState,
  tabCache,
  waitForTasks,
} from "./helpers/tasks-matrix";

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a create the page saw fail although the server stored it is stored once", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = `lost${Date.now().toString(36)}`;
  const title = `T ${id}`;
  const events: string[] = [];
  const context = await openUser(browser, OWNER);
  try {
    const listId = await createList(`L ${id}`);
    const sentUids: Array<string | null> = [];
    await context.route(/\/api\/v1\/tasks\/items$/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      sentUids.push((route.request().postDataJSON() as { uid?: string }).uid ?? null);
      if (sentUids.length > 1) return route.continue();
      // The server stores the task; the page never sees the answer.
      await route.fetch();
      await route.abort("failed");
    });

    const tab = await openTasksTab(context, "A", events);
    await tab.goto(`/tasks/lists/${encodeURIComponent(listId)}`);
    await waitForTasks(tab);
    const field = tab.getByRole("textbox", { name: "Quick add task" });
    await field.fill(title);
    await field.press("Enter");
    const rows = tab.locator(".list-item__title").getByText(title, { exact: true });
    await expect(rows).toHaveCount(1);
    // The page queued the create it saw fail; reload once it is in the outbox.
    await expect
      .poll(async () => (await tabCache(tab, id)).outbox, { message: "the create is queued" })
      .toEqual(["create"]);
    await tab.reload();
    await waitForTasks(tab);

    await expect
      .poll(() => sentUids.length, { message: "the outbox sends the create again" })
      .toBeGreaterThan(1);
    // Past a fallback poll: one task on the server and one row.
    await tab.waitForTimeout(3_000);
    const stored = (await serverState(id)).tasks.filter((task) => task.title === title);
    expect(stored, "tasks on the server").toHaveLength(1);
    await expect(rows).toHaveCount(1);
    // Both sends carried the UID the app picked before the first one.
    expect(sentUids[0]).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(new Set(sentUids)).toEqual(new Set([sentUids[0]]));
    // The aborted POST and the requests the reload cut off are expected.
    const unexpected = events.filter(
      (event) => !event.includes("request failed:") && !event.includes("net::ERR_FAILED"),
    );
    expect(unexpected).toEqual([]);
    expect((await tabCache(tab, id)).outbox).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
    await cleanUpCase(id).catch(() => undefined);
  }
});
