// Tasks inbound sync (live app, #1613). An open Tasks list follows changes
// made elsewhere (another tab, a phone, a CalDAV client) without a reload:
// within one poll while online, and right after reconnect.
//
// The changes are made through the REST API as the same user, which is what
// tab B, a phone or a CalDAV client does from tab A's point of view.
import { expect, test, type Page } from "./helpers/live-test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const USER = process.env.WGW_E2E_USERNAME ?? "admin";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

/** One poll (10 s) plus the time to re-list and paint. */
const FOLLOW_TIMEOUT_MS = 25_000;

type ServerTask = { id: string; title: string; etag?: string };

let accessToken: string | null = null;

async function token(): Promise<string> {
  if (accessToken) return accessToken;
  const res = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login ${USER} failed: ${res.status}`);
  accessToken = ((await res.json()) as { access_token: string }).access_token;
  return accessToken;
}

/** The other client: same user, straight to the REST API. */
async function api(
  method: string,
  path: string,
  body?: unknown,
  ifMatch?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${await token()}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ifMatch) headers["If-Match"] = ifMatch;
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
}

async function defaultTaskListId(): Promise<string> {
  const res = await api("GET", "/tasks/tasklists");
  const lists = (res.json as { list?: Array<{ id: string; isDefault?: boolean }> })?.list ?? [];
  const list = lists.find((entry) => entry.isDefault) ?? lists[0];
  if (!list) throw new Error(`No task list for ${USER} (${res.status})`);
  return list.id;
}

async function createTask(taskListId: string, title: string): Promise<ServerTask> {
  const res = await api("POST", "/tasks/items", { taskListIds: { [taskListId]: true }, title });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Create task failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json as ServerTask;
}

async function currentEtag(taskId: string): Promise<string | undefined> {
  const res = await api("GET", `/tasks/items/${encodeURIComponent(taskId)}`);
  return (res.json as ServerTask | null)?.etag;
}

async function renameTask(taskId: string, title: string): Promise<void> {
  const path = `/tasks/items/${encodeURIComponent(taskId)}`;
  const res = await api("PATCH", path, { title }, await currentEtag(taskId));
  if (res.status !== 200) throw new Error(`Rename task failed: ${res.status}`);
}

async function deleteTask(taskId: string): Promise<void> {
  const path = `/tasks/items/${encodeURIComponent(taskId)}`;
  const res = await api("DELETE", path, undefined, await currentEtag(taskId));
  if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
    throw new Error(`Delete task failed: ${res.status}`);
  }
}

function taskTitle(page: Page, title: string) {
  return page.locator(".tasks-main-view__title", { hasText: title });
}

async function openTasks(page: Page): Promise<void> {
  await page.goto("/tasks");
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
}

test.describe("Tasks inbound sync (live app)", () => {
  const created: string[] = [];

  test.afterEach(async () => {
    for (const id of created.splice(0)) await deleteTask(id).catch(() => undefined);
  });

  test("a task deleted and one renamed elsewhere update in an open list without a reload", async ({
    page,
  }) => {
    const stamp = Date.now();
    const listId = await defaultTaskListId();
    const toDelete = await createTask(listId, `e2e-inbound-delete-${stamp}`);
    const toRename = await createTask(listId, `e2e-inbound-rename-${stamp}`);
    created.push(toDelete.id, toRename.id);

    await openTasks(page);
    await expect(taskTitle(page, toDelete.title)).toBeVisible({ timeout: 30_000 });
    await expect(taskTitle(page, toRename.title)).toBeVisible();

    const renamed = `e2e-inbound-renamed-${stamp}`;
    await deleteTask(toDelete.id);
    await renameTask(toRename.id, renamed);

    await expect(taskTitle(page, toDelete.title)).toHaveCount(0, { timeout: FOLLOW_TIMEOUT_MS });
    await expect(taskTitle(page, renamed)).toBeVisible({ timeout: FOLLOW_TIMEOUT_MS });
    await expect(taskTitle(page, toRename.title)).toHaveCount(0);
  });

  test("changes made while the tab was offline show up after reconnect", async ({ page }) => {
    const stamp = Date.now();
    const listId = await defaultTaskListId();
    const toDelete = await createTask(listId, `e2e-inbound-off-delete-${stamp}`);
    const toRename = await createTask(listId, `e2e-inbound-off-rename-${stamp}`);
    created.push(toDelete.id, toRename.id);

    await openTasks(page);
    await expect(taskTitle(page, toDelete.title)).toBeVisible({ timeout: 30_000 });

    await page.context().setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 15_000 });

    const renamed = `e2e-inbound-off-renamed-${stamp}`;
    await deleteTask(toDelete.id);
    await renameTask(toRename.id, renamed);
    // Offline: nothing can arrive, so the old list stays.
    await page.waitForTimeout(2_000);
    await expect(taskTitle(page, toDelete.title)).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 20_000 });
    await expect(taskTitle(page, toDelete.title)).toHaveCount(0, { timeout: FOLLOW_TIMEOUT_MS });
    await expect(taskTitle(page, renamed)).toBeVisible({ timeout: FOLLOW_TIMEOUT_MS });
  });
});
