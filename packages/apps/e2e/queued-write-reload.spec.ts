// A list write queued behind its Undo toast survives a reload or leaving the list (live app, #1794).
//
// Unstarring a file or deleting a task waits 2.5 s behind an Undo toast. A reload or
// leaving the app inside that window must still reach the server.
import { expect, test, type Page } from "@playwright/test";
import { putDriveFile } from "./helpers/drive-seed";
import { E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);

/** The 2.5 s undo delay. */
const UNDO_DELAY_MS = 2_500;

async function seedAndStar(page: Page, name: string): Promise<void> {
  await putDriveFile(`users/${E2E_USERNAME}/${name}`, `Seeded ${RUN}\n`, "text/markdown");
  await page.goto("/drive");
  const row = rowOf(page, name);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Star", exact: true }).click();
  // The star is durable once the server lists it.
  await expect.poll(() => isStarredOnServer(page, name), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(UNDO_DELAY_MS);
}

function rowOf(page: Page, name: string) {
  return page
    .locator("li, tr, [role=row], [role=listitem], div")
    .filter({ hasText: name })
    .filter({ has: page.getByRole("button", { name: "More actions" }) })
    .last();
}

async function apiGet(page: Page, path: string): Promise<unknown> {
  const token = await page.evaluate(() => localStorage.getItem("wgw.api.access_token"));
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function isStarredOnServer(page: Page, name: string): Promise<boolean> {
  const body = (await apiGet(page, "/files/starred")) as { data: { paths?: string[] } };
  return (body.data.paths ?? []).some((path) => path.includes(name));
}

async function unstarFromStarredView(page: Page, name: string): Promise<void> {
  await page.goto("/drive?view=starred");
  const row = rowOf(page, name);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Unstar", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

test.describe("List writes inside the undo delay", () => {
  test("unstar then reload keeps the file unstarred", async ({ page }) => {
    const name = `Unstar reload ${RUN}.md`;
    await seedAndStar(page, name);
    await unstarFromStarredView(page, name);

    await page.waitForTimeout(300);
    await page.reload();

    await expect.poll(() => isStarredOnServer(page, name), { timeout: 15_000 }).toBe(false);
    await page.goto("/drive?view=starred");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("unstar then leave the list in the app still saves", async ({ page }) => {
    const name = `Unstar leave ${RUN}.md`;
    await seedAndStar(page, name);
    await unstarFromStarredView(page, name);

    await page.waitForTimeout(300);
    await page
      .getByRole("button", { name: /switch apps/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks/);

    await page.waitForTimeout(4_000);
    await expect.poll(() => isStarredOnServer(page, name), { timeout: 15_000 }).toBe(false);

    await page.goto("/drive?view=starred");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  // Tasks reads its offline cache (IndexedDB) before the request, so the write has to
  // start while the page still runs: a flush on `pagehide` alone loses it on a reload.
  test("delete a task then reload keeps it deleted", async ({ page }) => {
    const title = `Delete reload ${RUN}`;
    await page.goto("/tasks");
    const token = await page.evaluate(() => localStorage.getItem("wgw.api.access_token"));
    const created = await fetch(`${API}/api/v1/tasks/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        taskListIds: { "tasks-inbox": true },
        title,
        workflowStatus: "needs-action",
      }),
    });
    expect(created.ok).toBe(true);

    await page.reload();
    const taskTitle = page.getByText(title, { exact: true });
    await expect(taskTitle).toBeVisible({ timeout: 30_000 });
    await taskTitle.hover();
    await page
      .locator("div")
      .filter({ has: taskTitle })
      .filter({ has: page.getByRole("button", { name: "Task actions" }) })
      .last()
      .getByRole("button", { name: "Task actions" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(taskTitle).toHaveCount(0);

    await page.waitForTimeout(300);
    await page.reload();

    const taskExists = async () => {
      const body = (await apiGet(page, "/tasks/items?taskListId=tasks-inbox")) as {
        list: Array<{ title: string }>;
      };
      return body.list.some((task) => task.title === title);
    };
    await expect.poll(taskExists, { timeout: 15_000 }).toBe(false);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  });
});
