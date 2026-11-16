import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  api,
  cleanUpCase,
  createList,
  createTask,
  ensureTasksTeam,
  openTasksTab,
  openUser,
  OWNER,
  patchTask,
  readAllNotifications,
  shareList,
  showAllTasks,
  TEAMMATE,
  type Tab,
  revealTask,
} from "./helpers/tasks-matrix";

/**
 * #1665: a change to a shared list made by a teammate reaches the owner's open
 * Tasks tab on push (create, rename, complete, delete), and again after the
 * tab reloads.
 *
 * Bound: 8 s, well inside the 10 s inbound poll. While push is connected the
 * fallback poll runs every 60 s, and the whole spec runs well within 60 s of
 * push connecting, so a pass proves the push path. The teammate writes over
 * REST, so no other tab of the owner sees the change first.
 */

const PUSH_BOUND_MS = 8_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a teammate's changes to a shared list reach the owner's open tab on push", async ({
  browser,
}) => {
  const id = `push${Date.now().toString(36)}`;
  await ensureTasksTeam();
  const events: string[] = [];
  let context: BrowserContext | null = null;

  try {
    const listId = await createList(`L ${id}`);
    await shareList(listId, TEAMMATE, "write");
    const rename = await createTask(listId, `rename ${id}`);
    const complete = await createTask(listId, `complete ${id}`);
    const remove = await createTask(listId, `delete ${id}`);

    // The teammate sees the shared list under an id of their own.
    const lists = await api(TEAMMATE, "GET", "/tasks/tasklists");
    const mateList = (
      (lists.json as { list?: Array<{ id: string; name: string }> }).list ?? []
    ).find((list) => list.name === `L ${id}`);
    if (!mateList) throw new Error("The shared list is not visible to the teammate.");

    context = await openUser(browser, OWNER);
    const connected = pushConnected(context);
    const tab = await openTasksTab(context, "owner", events);
    await showAllTasks(tab);
    await connected;
    for (const task of [rename, complete, remove])
      await expect.poll(() => revealTask(tab, task.title, false)).toBe(true);

    const first = await teammateEdits(tab, id, mateList.id, { rename, complete, remove }, "1");
    test.info().annotations.push({ type: "latency", description: `first: ${first} ms` });
    expect(first).toBeLessThan(PUSH_BOUND_MS);

    // After a reload the stream must connect again and carry the next change.
    const reconnected = pushConnected(context);
    await tab.reload();
    await showAllTasks(tab);
    await reconnected;
    const created = `after reload ${id}`;
    const sentAt = Date.now();
    await createTask(mateList.id, created, {}, TEAMMATE);
    await expect.poll(() => revealTask(tab, created, false), { timeout: PUSH_BOUND_MS }).toBe(true);
    const second = Date.now() - sentAt;
    test.info().annotations.push({ type: "latency", description: `after reload: ${second} ms` });
    expect(second).toBeLessThan(PUSH_BOUND_MS);
    console.log(`[tasks-push] teammate edits → owner tab: ${first} ms, after reload ${second} ms`);
  } finally {
    await context?.close();
    await cleanUpCase(id);
    for (const user of [OWNER, TEAMMATE]) await readAllNotifications(user).catch(() => undefined);
  }
});

type Row = { id: string; title: string };

/**
 * The teammate creates, renames, completes and deletes. Returns the time from
 * the first write until all four show in the owner's tab.
 */
async function teammateEdits(
  tab: Tab,
  id: string,
  mateListId: string,
  rows: { rename: Row; complete: Row; remove: Row },
  tag: string,
): Promise<number> {
  const created = `created ${tag} ${id}`;
  const renamed = `renamed ${tag} ${id}`;
  const sentAt = Date.now();
  await createTask(mateListId, created, {}, TEAMMATE);
  const patched = await patchTask(rows.rename.id, { title: renamed }, TEAMMATE);
  expect(patched.status, JSON.stringify(patched.json)).toBe(200);
  const done = await patchTask(rows.complete.id, { workflowStatus: "completed" }, TEAMMATE);
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  const current = await api(TEAMMATE, "GET", `/tasks/items/${encodeURIComponent(rows.remove.id)}`);
  const etag = (current.json as { etag?: string }).etag ?? "";
  const deleted = await api(
    TEAMMATE,
    "DELETE",
    `/tasks/items/${encodeURIComponent(rows.remove.id)}`,
    undefined,
    { "If-Match": etag },
  );
  expect([200, 204], JSON.stringify(deleted.json)).toContain(deleted.status);

  const left = () => Math.max(1, PUSH_BOUND_MS - (Date.now() - sentAt));
  await expect.poll(() => revealTask(tab, created, false), { timeout: left() }).toBe(true);
  await expect.poll(() => revealTask(tab, renamed, false), { timeout: left() }).toBe(true);
  await expect
    .poll(() => revealTask(tab, rows.rename.title, false), { timeout: left() })
    .toBe(false);
  // "All Tasks" hides completed tasks.
  await expect
    .poll(() => revealTask(tab, rows.complete.title, false), { timeout: left() })
    .toBe(false);
  await expect
    .poll(() => revealTask(tab, rows.remove.title, false), { timeout: left() })
    .toBe(false);
  return Date.now() - sentAt;
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
