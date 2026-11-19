import { expect, test, type BrowserContext } from "./helpers/live-test";
import { api, chatMessageId } from "./helpers/live-matrix";
import {
  cleanUpCase,
  createList,
  createTask,
  openTasksTab,
  openUser,
  OWNER,
  revealTask,
  showAllTasks,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #2173 slice E: the comments under a task stay fresh in every open tab without
 * a reload (poll `/changes` every 15 s, and on focus), survive a reload, and show
 * from the offline read cache with "Last updated" when the browser is offline.
 * A second client of the same account writes over REST.
 */

const SEEN_MS = 25_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

async function openTask(tab: Tab, title: string): Promise<void> {
  await expect.poll(() => revealTask(tab, title), { timeout: 30_000 }).toBe(true);
  await tab
    .locator(".tasks-list-row")
    .filter({ has: tab.locator(".list-item__title").getByText(title, { exact: true }) })
    .locator(".list-item__button")
    .click();
  await expect(
    tab.locator(".tasks-detail-view").getByRole("textbox", { name: "Task name" }),
  ).toHaveValue(title, { timeout: 10_000 });
}

const panel = (tab: Tab) => tab.getByRole("region", { name: "Comments" });

test("task comments reach another open tab, survive a reload, and read offline", async ({
  browser,
}) => {
  const id = `thr${Date.now().toString(36)}`;
  const title = `thread ${id}`;
  const events: string[] = [];
  let context: BrowserContext | null = null;

  try {
    const listId = await createList(`L ${id}`);
    const task = await createTask(listId, title);
    const base = `/threads/task/${encodeURIComponent(task.id)}/entries`;

    context = await openUser(browser, OWNER);
    const tabA = await openTasksTab(context, "A", events);
    const tabB = await openTasksTab(context, "B", events);
    for (const tab of [tabA, tabB]) {
      await showAllTasks(tab);
      await openTask(tab, title);
      await expect(panel(tab)).toBeVisible();
    }

    // A comment typed in tab A shows once there, then in tab B without a reload.
    const typed = `typed ${id}`;
    await panel(tabA).locator(".ProseMirror").click();
    await tabA.keyboard.type(typed);
    await tabA.keyboard.press("Enter");
    await expect(panel(tabA).getByText(typed)).toHaveCount(1, { timeout: 15_000 });
    await expect(panel(tabB).getByText(typed)).toHaveCount(1, { timeout: SEEN_MS });

    // An edit made elsewhere reaches tab B as well.
    const listed = await api(OWNER, "GET", base);
    const entry = (listed.json as { list: { id: string; body: string | null }[] }).list.find(
      (item) => item.body === typed,
    );
    expect(entry, JSON.stringify(listed.json)).toBeTruthy();
    const edited = `edited ${id}`;
    const patched = await api(OWNER, "PATCH", `${base}/${entry!.id}`, { body: edited });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    await expect(panel(tabB).getByText(edited)).toHaveCount(1, { timeout: SEEN_MS });
    await expect(panel(tabB).getByText(typed)).toHaveCount(0);

    // After a reload the comment shows once.
    await tabB.reload();
    await showAllTasks(tabB);
    await openTask(tabB, title);
    await expect(panel(tabB).getByText(edited)).toHaveCount(1, { timeout: 15_000 });

    // Offline: the reloaded tab reads the cached thread and says when it was fetched.
    await tabB.route("**/api/v1/**", (route) => route.abort("failed"));
    await tabB.reload();
    await showAllTasks(tabB);
    await openTask(tabB, title);
    await expect(panel(tabB).getByText(edited)).toHaveCount(1, { timeout: 15_000 });
    await expect(panel(tabB).getByText(/Last updated/)).toBeVisible();

    // Back online: a comment from another client shows without a reload.
    await tabB.unroute("**/api/v1/**");
    const later = `later ${id}`;
    const posted = await api(OWNER, "POST", base, { id: chatMessageId(), body: later });
    expect([200, 201], JSON.stringify(posted.json)).toContain(posted.status);
    await expect(panel(tabB).getByText(later)).toHaveCount(1, { timeout: SEEN_MS });
    await expect(panel(tabB).getByText(/Last updated/)).toHaveCount(0);
  } finally {
    await context?.close();
    await cleanUpCase(id);
  }
});
