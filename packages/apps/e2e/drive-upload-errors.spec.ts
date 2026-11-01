import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME, expectOfflineIndicator } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const FULL = "The server is full";
const WAITING_SPACE = "Waiting for space on the server";
const GONE = "The folder no longer exists";

function uploadInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Upload files"]');
}

async function openMyDrive(page: Page): Promise<void> {
  await page.goto("/drive");
  await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Loading folder…")).toHaveCount(0, { timeout: 30_000 });
  // The folder listing is written to the offline cache just after it paints.
  await page.waitForTimeout(3_000);
}

async function pickFile(page: Page, name: string): Promise<void> {
  await uploadInput(page).setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`drive upload errors ${name}`),
  });
}

/** Offline in a way a reload survives: only fetch, XHR and event streams fail. */
async function goOfflineKeepingShell(page: Page): Promise<void> {
  await page.context().route("**/*", (route) => {
    const type = route.request().resourceType();
    return type === "fetch" || type === "xhr" || type === "eventsource"
      ? route.abort("internetdisconnected")
      : route.fallback();
  });
  await page.evaluate(() => {
    sessionStorage.setItem("e2e-offline", "1");
    window.dispatchEvent(new Event("offline"));
  });
  await expectOfflineIndicator(page);
}

async function goOnlineAgain(page: Page): Promise<void> {
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
  await page.evaluate(() => {
    sessionStorage.removeItem("e2e-offline");
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 30_000 });
}

function uniqueName(label: string): string {
  return `e2e-upload-${label}-${Date.now()}`;
}

/** Entries of a folder on the server (name and type). Needs the page to be online. */
async function serverList(page: Page, folder: string): Promise<{ name: string; type: string }[]> {
  return page.evaluate(
    async ([username, sub]) => {
      const token = localStorage.getItem("wgw.api.access_token");
      const path = sub ? `/users/${username}/${sub}` : `/users/${username}`;
      const response = await fetch(`/api/v1/files/children?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Listing failed (${response.status})`);
      const payload = (await response.json()) as {
        data: { files: { name: string; type: string }[] };
      };
      return payload.data.files;
    },
    [E2E_USERNAME, folder],
  );
}

async function namesIn(page: Page, folder: string): Promise<string[]> {
  return (await serverList(page, folder)).map((entry) => entry.name);
}

type FileNodeRow = { id: string; name: string; parentId: string | null };

/**
 * A change made on the server by "another device": plain requests with the
 * page's token. They bypass the page routes that keep the first tab offline,
 * and no second app tab runs an uploader that would race the queued file.
 */
async function jmapFileNodes(page: Page, method: string, args: Record<string, unknown>) {
  const token = await page.evaluate(() => localStorage.getItem("wgw.api.access_token"));
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const session = (await (
    await page.context().request.get(`${API}/api/v1/jmap/session`, { headers })
  ).json()) as {
    apiUrl: string;
    primaryAccounts: Record<string, string>;
  };
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:filenode"]!;
  const response = await page.context().request.post(session.apiUrl, {
    headers,
    data: {
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:filenode"],
      methodCalls: [[method, { accountId, ...args }, "c0"]],
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    methodResponses: [string, Record<string, unknown>, string][];
  };
  const [name, result] = body.methodResponses[0]!;
  expect(name).toBe(method);
  return result;
}

async function findNode(page: Page, name: string, parentId?: string | null): Promise<FileNodeRow> {
  const result = await jmapFileNodes(page, "FileNode/get", { ids: null });
  const nodes = result.list as FileNodeRow[];
  const found = nodes.find(
    (node) => node.name === name && (parentId === undefined || node.parentId === parentId),
  );
  expect(found, `folder ${name} on the server`).toBeDefined();
  return found!;
}

async function renameFolderOnServer(page: Page, from: string, to: string): Promise<void> {
  const node = await findNode(page, from);
  const result = await jmapFileNodes(page, "FileNode/set", { update: { [node.id]: { name: to } } });
  expect(result.updated).toBeTruthy();
}

/** Moves the folder into the root's `.Trash`, as the app's Delete does. */
async function trashFolderOnServer(page: Page, name: string): Promise<void> {
  const node = await findNode(page, name);
  const nodes = (await jmapFileNodes(page, "FileNode/get", { ids: null })).list as FileNodeRow[];
  let root = nodes.find((n) => n.id === node.parentId)!;
  let trash = nodes.find((n) => n.name === ".Trash" && n.parentId === root.id);
  if (!trash) {
    const created = await jmapFileNodes(page, "FileNode/set", {
      create: { t0: { parentId: root.id, name: ".Trash" } },
    });
    trash = (created.created as Record<string, FileNodeRow>).t0!;
  }
  const result = await jmapFileNodes(page, "FileNode/set", {
    update: { [node.id]: { parentId: trash.id } },
  });
  expect(result.updated).toBeTruthy();
}

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByPlaceholder("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => namesIn(page, ""), { timeout: 30_000 }).toContain(name);
}

async function openFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).dblclick();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(name)), { timeout: 30_000 });
  await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
  await expect(page.getByText("Loading folder…")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

async function openUploads(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Uploads/ }).click();
}

function uploadRow(page: Page, name: string) {
  return page.locator(".drive-uploads__row", { hasText: name });
}

test.describe("Drive upload errors (live app)", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => sessionStorage.getItem("e2e-offline") !== "1",
      });
    });
  });

  /** Tab 1 makes folder `folder`, opens it, goes offline and queues `file` there. */
  async function queueIntoFolder(page: Page, folder: string, file: string): Promise<Page> {
    await openMyDrive(page);
    await createFolder(page, folder);
    const other = await page.context().newPage();
    await openMyDrive(other);
    await openFolder(page, folder);
    await goOfflineKeepingShell(page);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(folder)));
    await pickFile(page, file);
    await expect(page.getByText(file, { exact: true })).toBeVisible();
    return other;
  }

  test("a folder renamed in another tab still receives the queued file", async ({ page }) => {
    const from = uniqueName("a");
    const to = uniqueName("b");
    const file = `${uniqueName("renamed")}.txt`;
    const other = await queueIntoFolder(page, from, file);

    await renameFolderOnServer(other, from, to);
    await goOnlineAgain(page);

    await expect.poll(() => namesIn(other, to), { timeout: 60_000 }).toContain(file);
    expect(await namesIn(other, from)).not.toContain(file);
    // Nothing failed: the queue is empty in both tabs.
    await expect(other.getByRole("button", { name: /^Uploads/ })).toHaveCount(0, {
      timeout: 60_000,
    });
    for (const tab of [page, other]) {
      await openMyDrive(tab);
      await openFolder(tab, to);
      await expect(tab.getByText(file, { exact: true })).toBeVisible({ timeout: 30_000 });
    }
  });

  test("a folder trashed in another tab fails the queued file as gone, and it stays after a reload", async ({
    page,
  }) => {
    const folder = uniqueName("trashed");
    const file = `${uniqueName("trashed-file")}.txt`;
    const other = await queueIntoFolder(page, folder, file);

    await trashFolderOnServer(other, folder);
    await goOnlineAgain(page);

    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText(GONE, { timeout: 60_000 });
    await openUploads(other);
    await expect(uploadRow(other, file)).toContainText(GONE, { timeout: 60_000 });

    expect(await namesIn(other, "")).not.toContain(file);
    expect(await namesIn(other, ".Trash")).not.toContain(file);
    expect(await namesIn(other, `.Trash/${folder}`)).not.toContain(file);

    await page.reload();
    await expect(uploadInput(page)).toBeAttached({ timeout: 30_000 });
    await openUploads(page);
    await expect(uploadRow(page, file)).toContainText(GONE, { timeout: 30_000 });
  });

  test("a full server pauses the queue, and Retry uploads every file once", async ({ page }) => {
    const first = `${uniqueName("full-1")}.txt`;
    const second = `${uniqueName("full-2")}.txt`;
    await openMyDrive(page);
    const other = await page.context().newPage();
    await openMyDrive(other);

    let reachedServer = 0;
    // On the context: the second tab runs an uploader too.
    await page.context().route("**/jmap/upload**", (route) => {
      reachedServer += 1;
      return route.fulfill({
        status: 507,
        contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:ietf:params:jmap:error:overQuota", status: 507 }),
      });
    });
    await uploadInput(page).setInputFiles([
      { name: first, mimeType: "text/plain", buffer: Buffer.from("first") },
      { name: second, mimeType: "text/plain", buffer: Buffer.from("second") },
    ]);

    await openUploads(page);
    await expect(uploadRow(page, first)).toContainText(FULL, { timeout: 60_000 });
    await expect(uploadRow(page, second)).toContainText(WAITING_SPACE, { timeout: 60_000 });
    await openUploads(other);
    await expect(uploadRow(other, first)).toContainText(FULL, { timeout: 60_000 });
    await expect(uploadRow(other, second)).toContainText(WAITING_SPACE, { timeout: 60_000 });
    // Only the first file asked; the second never reached the server.
    expect(reachedServer).toBeGreaterThan(0);
    expect(await namesIn(page, "")).not.toContain(second);

    await page.context().unroute("**/jmap/upload**");
    await uploadRow(page, first)
      .getByRole("button", { name: `Retry ${first}` })
      .click();

    await expect(page.locator(".drive-upload-status")).toHaveCount(0, { timeout: 90_000 });
    await expect
      .poll(
        async () => {
          const names = await namesIn(page, "");
          return [first, second].map((name) => names.filter((n) => n === name).length);
        },
        { timeout: 60_000 },
      )
      .toEqual([1, 1]);
  });
});
