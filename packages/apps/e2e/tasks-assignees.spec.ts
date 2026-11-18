// Assigning people to a task offline (live app and API, #2172).
//
// The picker offers the list audience, cached on the last online visit. Offline
// assignments queue as one patch that merges person by person; a rescue into
// another list keeps only the assignees that list accepts.
import { expect, test } from "./helpers/live-test";
import {
  api,
  cleanUpCase,
  createList,
  createTask,
  openTasksTab,
  openUser,
  OWNER,
  setTabOffline,
  shareList,
  TEAMMATE,
  waitForTasks,
  type Tab,
} from "./helpers/tasks-matrix";

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

type Member = { username: string; displayName?: string | null };

/** The people of a list as the owner's API shows them, by username. */
async function audience(listId: string): Promise<Map<string, string>> {
  const res = await api(OWNER, "GET", `/tasks/tasklists/${encodeURIComponent(listId)}/members`);
  const list = (res.json as { list?: Member[] }).list ?? [];
  return new Map(list.map((m) => [m.username, m.displayName || m.username]));
}

/** The participant ids a task has on the server, as `user` sees it. */
async function assigneeIds(taskId: string, user = OWNER): Promise<string[]> {
  const res = await api(user, "GET", `/tasks/items/${encodeURIComponent(taskId)}`);
  const task = res.json as { participants?: Record<string, unknown> | null };
  return Object.keys(task.participants ?? {}).sort();
}

function row(tab: Tab, title: string) {
  return tab.locator(".tasks-list-row").filter({
    has: tab.locator(".list-item__title").getByText(title, { exact: true }),
  });
}

async function openTask(tab: Tab, title: string) {
  await row(tab, title).locator(".list-item__button").click();
  const detail = tab.locator(".tasks-detail-view");
  await expect(detail.getByRole("textbox", { name: "Task name" })).toHaveValue(title);
  return detail;
}

async function openList(tab: Tab, listId: string) {
  await tab.goto(`/tasks/lists/${encodeURIComponent(listId)}`);
  await waitForTasks(tab);
}

/** The picker of the open task, with the people it lists. */
async function openPicker(tab: Tab) {
  await tab
    .locator(".tasks-detail-view")
    .getByRole("button", { name: /^Assignee:/ })
    .click();
  return tab.getByRole("listbox", { name: "Assignee" });
}

async function toggle(tab: Tab, name: string) {
  await tab.getByRole("option", { name }).click();
}

test("assignments made offline merge per person and land once online", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = `asg${Date.now().toString(36)}`;
  const title = `T ${id}`;
  const events: string[] = [];
  const owner = await openUser(browser, OWNER);
  try {
    const listId = await createList(`L ${id}`);
    await shareList(listId, TEAMMATE, "write");
    const task = await createTask(listId, title);
    const names = await audience(listId);
    const mate = names.get(TEAMMATE)!;
    const me = names.get(OWNER)!;

    const a = await openTasksTab(owner, "A", events);
    const b = await openTasksTab(owner, "B", events);
    for (const tab of [a, b]) await openList(tab, listId);

    await openTask(a, title);
    const picker = await openPicker(a);
    await expect(picker.getByRole("option", { name: new RegExp(mate) })).toBeVisible();
    await a.keyboard.press("Escape");

    await setTabOffline(a, true);
    await openPicker(a);
    await toggle(a, mate);
    await toggle(a, me);
    await toggle(a, mate);
    await a.keyboard.press("Escape");
    await setTabOffline(a, false);

    await expect.poll(() => assigneeIds(task.id), { timeout: 30_000 }).toEqual([`u:${OWNER}`]);

    for (const tab of [b, a]) {
      if (tab === a) {
        await a.reload();
        await waitForTasks(a);
        await openList(a, listId);
      }
      await expect(row(tab, title).locator(".tasks-assignee-avatars__item")).toHaveCount(1, {
        timeout: 30_000,
      });
      await openTask(tab, title);
      await expect(
        tab.locator(".tasks-detail-view").getByRole("button", { name: /^Assignee:/ }),
      ).toContainText(me);
    }
    await b.reload();
    await waitForTasks(b);
    await openList(b, listId);
    await expect(row(b, title).locator(".tasks-assignee-avatars__item")).toHaveCount(1);
  } finally {
    await owner.close().catch(() => undefined);
    await cleanUpCase(id).catch(() => undefined);
  }
});

test("the picker offline with no cached audience assigns no one", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = `asn${Date.now().toString(36)}`;
  const title = `T ${id}`;
  const events: string[] = [];
  const owner = await openUser(browser, OWNER);
  try {
    const listId = await createList(`M ${id}`);
    await shareList(listId, TEAMMATE, "write");
    const task = await createTask(listId, title);
    const tab = await openTasksTab(owner, "A", events);
    await openList(tab, listId);
    await expect(row(tab, title)).toBeVisible({ timeout: 30_000 });
    // The detail loads the audience when it opens, so go offline before that.
    await setTabOffline(tab, true);
    await openTask(tab, title);
    await openPicker(tab);
    await expect(tab.getByText("Connect to load people")).toBeVisible();
    await expect(tab.getByRole("option")).toHaveCount(0);
    await tab.keyboard.press("Escape");
    await setTabOffline(tab, false);
    expect(await assigneeIds(task.id)).toEqual([]);
  } finally {
    await owner.close().catch(() => undefined);
    await cleanUpCase(id).catch(() => undefined);
  }
});

test("a rescued task keeps only the assignees its new list accepts", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = `asr${Date.now().toString(36)}`;
  const title = `N ${id}`;
  const events: string[] = [];
  const mateContext = await openUser(browser, TEAMMATE);
  try {
    const listA = `M ${id}`;
    const listB = `M ${id} b`;
    const listAId = await createList(listA);
    const listBId = await createList(listB);
    await createTask(listAId, `S ${id}`);
    await shareList(listAId, TEAMMATE, "write");
    await shareList(listBId, TEAMMATE, "write");
    const names = await audience(listAId);
    const me = names.get(OWNER)!;

    // A shared list has another id for the teammate.
    const mateLists = (await api(TEAMMATE, "GET", "/tasks/tasklists")).json as {
      list?: Array<{ id: string; name: string }>;
    };
    const mateListAId = mateLists.list?.find((l) => l.name === listA)?.id ?? "";
    const mateListBId = mateLists.list?.find((l) => l.name === listB)?.id ?? "";
    expect(mateListAId).not.toBe("");
    expect(mateListBId).not.toBe("");
    const b = await openTasksTab(mateContext, "B", events, TEAMMATE);
    await openList(b, mateListAId);
    // Cache the audience of the list the task is added to.
    await openTask(b, `S ${id}`);
    await openPicker(b);
    await expect(b.getByRole("option", { name: new RegExp(me) })).toBeVisible();
    await b.keyboard.press("Escape");

    await setTabOffline(b, true);
    const field = b.getByRole("textbox", { name: "Quick add task" });
    await field.fill(title);
    await field.press("Enter");
    await openTask(b, title);
    await openPicker(b);
    await toggle(b, me);
    await b.keyboard.press("Escape");

    await shareList(listAId, TEAMMATE, "read");
    await setTabOffline(b, false);

    const dialog = b.getByRole("dialog", { name: /^(A task|\d+ tasks) from / });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Move to: New list" }).click();
    await b.getByRole("menuitem", { name: listB, exact: true }).click();
    await dialog.getByRole("button", { name: /^Move (task|\d+ tasks)$/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    let rescuedId = "";
    await expect
      .poll(
        async () => {
          const res = await api(
            TEAMMATE,
            "GET",
            `/tasks/items?taskListId=${encodeURIComponent(mateListBId)}`,
          );
          const rescued = (
            (res.json as { list?: Array<{ id: string; title?: string }> }).list ?? []
          ).filter((t) => t.title === title);
          rescuedId = rescued[0]?.id ?? "";
          return rescued.length;
        },
        { timeout: 30_000, message: "the rescued task is in the teammate's list" },
      )
      .toBe(1);
    // The target list's audience is not cached: only the rescuer may stay.
    const ids = await assigneeIds(rescuedId, TEAMMATE);
    expect(ids.filter((p) => p !== `u:${TEAMMATE}`)).toEqual([]);
  } finally {
    await mateContext.close().catch(() => undefined);
    await cleanUpCase(id).catch(() => undefined);
    const mine = await api(TEAMMATE, "GET", "/tasks/tasklists");
    for (const list of (mine.json as { list?: Array<{ id: string; name: string }> }).list ?? []) {
      if (list.name.includes(id)) {
        await api(TEAMMATE, "DELETE", `/tasks/tasklists/${encodeURIComponent(list.id)}`, {
          onDestroyRemoveContents: true,
        }).catch(() => undefined);
      }
    }
  }
});
