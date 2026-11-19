import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { openUser, OWNER, passwordFor } from "./helpers/live-matrix";
import {
  cleanUpCase,
  createList,
  createTask,
  revealTask,
  waitForTasks,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #2261: Tasks and Drive in several tabs of one browser.
 *
 * Tasks: one tab polls and pulls `tasks/tasklists/changes`; the other tabs
 * repaint from the shared cache and send none. The next tab takes over when
 * the syncing tab closes, and a visible tab takes over from a hidden one, so
 * changes still arrive with push down.
 *
 * Drive: tabs that show the same folder fetch its listing once between them
 * after a change. A tab on another folder fetches its own.
 *
 * Every write comes over the API or WebDAV, like another device, so no tab
 * sees it first.
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
/** A change must show in every tab within this, on push. */
const PUSH_BOUND_MS = 8_000;
/** With push down the 10 s poll brings it. */
const POLL_BOUND_MS = 20_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("Tasks: one of three tabs syncs, and another takes over when it closes or is hidden", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const run = `onetab${Date.now().toString(36)}`;
  const context = await openUser(browser, OWNER);
  await allowHiding(context);
  const shows = (tab: Page, title: string, timeout: number) =>
    expect.poll(() => revealTask(tab, title), { timeout }).toBe(true);

  try {
    const listId = await createList(`L ${run}`);
    const connected = pushConnected(context);
    const tabs = [await context.newPage(), await context.newPage(), await context.newPage()];
    const calls = tabs.map((tab) => countRequests(tab, isTasksChanges));
    for (const tab of tabs) {
      await tab.goto("/tasks");
      await waitForTasks(tab as Tab);
      await tab.getByRole("button", { name: "All Tasks" }).click();
    }
    await connected;
    // Every tab has loaded and taken its seat once it shows a first write.
    await tabs[0]!.waitForTimeout(3_000);
    await createTask(listId, `${run} warm-up`);
    await Promise.all(tabs.map((tab) => shows(tab, `${run} warm-up`, 15_000)));
    await tabs[0]!.waitForTimeout(1_000);

    // Three tabs: every tab shows the task, one tab asked the server.
    let before = calls.map((count) => count());
    await createTask(listId, `${run} three tabs`);
    await Promise.all(tabs.map((tab) => shows(tab, `${run} three tabs`, PUSH_BOUND_MS)));
    let made = calls.map((count, index) => count() - before[index]!);
    const syncing = made.findIndex((count) => count > 0);
    expect(
      made.filter((count) => count > 0),
      `one syncing tab: ${made}`,
    ).toHaveLength(1);

    // The syncing tab closes: one of the other two takes over.
    await tabs[syncing]!.close();
    const open = tabs.filter((_, index) => index !== syncing);
    const openCalls = calls.filter((_, index) => index !== syncing);
    await open[0]!.waitForTimeout(1_500);
    before = openCalls.map((count) => count());
    await createTask(listId, `${run} after close`);
    await Promise.all(open.map((tab) => shows(tab, `${run} after close`, PUSH_BOUND_MS)));
    made = openCalls.map((count, index) => count() - before[index]!);
    const next = made.findIndex((count) => count > 0);
    expect(
      made.filter((count) => count > 0),
      `one syncing tab after the close: ${made}`,
    ).toHaveLength(1);

    // Push goes down and the syncing tab is hidden: the visible tab polls.
    await context.route(/\/api\/v1\/jmap\/events\//, (route) => route.abort());
    const hidden = open[next]!;
    const visible = open[1 - next]!;
    await hidden.evaluate(() => (window as unknown as HideableWindow).__setHidden(true));
    await visible.waitForTimeout(1_500);
    before = openCalls.map((count) => count());
    await createTask(listId, `${run} hidden owner`);
    await shows(visible, `${run} hidden owner`, POLL_BOUND_MS);
    made = openCalls.map((count, index) => count() - before[index]!);
    expect(made[1 - next], `the visible tab syncs: ${made}`).toBeGreaterThan(0);
    expect(made[next], `the hidden tab does not: ${made}`).toBe(0);
    // The hidden tab reads the cache the visible tab wrote.
    await shows(hidden, `${run} hidden owner`, PUSH_BOUND_MS);
  } finally {
    await context.close();
    await cleanUpCase(run);
  }
});

test("Drive: tabs on the same folder share one listing fetch per change", async ({ browser }) => {
  test.setTimeout(300_000);
  const run = `onetab${Date.now().toString(36)}`;
  const folder = `Shared fetch ${run}`;
  const sub = `${folder}/Sub`;
  const context = await openUser(browser, OWNER);
  const shows = (tab: Page, name: string, timeout: number) =>
    expect(tab.getByText(name, { exact: true }).first()).toBeVisible({ timeout });

  try {
    await dav("MKCOL", `${enc(folder)}/`);
    await dav("MKCOL", `${enc(sub)}/`);
    await put(folder, "seed.txt");
    await put(sub, "sub-seed.txt");

    const connected = pushConnected(context);
    const same = [await context.newPage(), await context.newPage(), await context.newPage()];
    const other = await context.newPage();
    const calls = same.map((tab) => countRequests(tab, isFolderListing));
    const otherCalls = countRequests(other, isFolderListing);
    for (const tab of same) {
      await tab.goto(folderUrl(folder));
      await shows(tab, "seed.txt", 30_000);
    }
    await other.goto(folderUrl(sub));
    await shows(other, "sub-seed.txt", 30_000);
    await connected;
    // A tab's start-up loads its folder more than once and runs its own
    // FileNode pull; count only once every tab has gone quiet.
    await quiet([...calls, otherCalls]);

    // Three tabs on the folder: all show the file, one fetched the listing.
    let before = calls.map((count) => count());
    const otherBefore = otherCalls();
    await put(folder, "three-tabs.txt");
    await Promise.all(same.map((tab) => shows(tab, "three-tabs.txt", PUSH_BOUND_MS)));
    await same[0]!.waitForTimeout(1_000);
    let made = calls.map((count, index) => count() - before[index]!);
    const fetching = made.findIndex((count) => count > 0);
    expect(
      made.filter((count) => count > 0),
      `one tab fetched the folder: ${made}`,
    ).toHaveLength(1);
    // A tab on another folder needs its own listing, as before.
    expect(otherCalls() - otherBefore, "the tab on the sub folder").toBeGreaterThan(0);

    // A change in the sub folder shows in the tab that has it open.
    await put(sub, "in-sub.txt");
    await shows(other, "in-sub.txt", PUSH_BOUND_MS);

    // The tab that fetched closes: the other two still get the next change, with one fetch.
    await same[fetching]!.close();
    const open = same.filter((_, index) => index !== fetching);
    const openCalls = calls.filter((_, index) => index !== fetching);
    before = openCalls.map((count) => count());
    await put(folder, "after-close.txt");
    await Promise.all(open.map((tab) => shows(tab, "after-close.txt", PUSH_BOUND_MS)));
    await open[0]!.waitForTimeout(1_000);
    made = openCalls.map((count, index) => count() - before[index]!);
    expect(
      made.filter((count) => count > 0),
      `one tab fetched after the close: ${made}`,
    ).toHaveLength(1);

    // A delete reaches both tabs too.
    await dav("DELETE", `${enc(folder)}/${enc("seed.txt")}`);
    await Promise.all(
      open.map((tab) =>
        expect(tab.getByText("seed.txt", { exact: true })).toHaveCount(0, {
          timeout: PUSH_BOUND_MS,
        }),
      ),
    );
  } finally {
    await context.close();
    await dav("DELETE", `${enc(folder)}/`).catch(() => undefined);
  }
});

test("Drive: a large upload in one tab shows once in a tab that watches the folder", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const run = `onetab${Date.now().toString(36)}`;
  const folder = `Upload watch ${run}`;
  const name = `large-${run}.bin`;
  const context = await openUser(browser, OWNER);
  const uploadInput = (tab: Page) => tab.locator('input[type="file"][aria-label="Upload files"]');
  const row = (tab: Page) => tab.getByText(name, { exact: true });

  try {
    await dav("MKCOL", `${enc(folder)}/`);
    await put(folder, "seed.txt");
    const connected = pushConnected(context);
    const uploader = await context.newPage();
    const watcher = await context.newPage();
    for (const tab of [uploader, watcher]) {
      await tab.goto(folderUrl(folder));
      await expect(tab.getByText("seed.txt", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    }
    await connected;
    // Small parts, so the file goes up in many requests like a large one.
    const partSize = 256 * 1024;
    await uploader.evaluate(
      ([username, size]) => localStorage.setItem(`wgw-drive-part-size:${username}`, size!),
      [OWNER, String(partSize)],
    );
    await uploader.reload();
    await expect(uploadInput(uploader)).toBeAttached({ timeout: 30_000 });
    await expect(uploader.getByText("seed.txt", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await uploader.waitForTimeout(3_000);

    // Whichever tab of the browser runs the upload queue sends the parts.
    let parts = 0;
    context.on("request", (request) => {
      if (request.url().includes("/jmap/upload") && request.method() === "POST") parts += 1;
    });
    const buffer = Buffer.alloc(24 * partSize + 100);
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = (i * 31 + (i >> 8)) & 0xff;
    await uploadInput(uploader).setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer,
    });

    // The watching tab shows the file while it goes up, and still exactly once after.
    await expect(row(watcher).first()).toBeVisible({ timeout: 30_000 });
    await expect(uploader.locator(".drive-upload-status")).toHaveCount(0, { timeout: 120_000 });
    expect(parts, "the file went up in parts").toBeGreaterThan(10);
    for (const tab of [uploader, watcher]) {
      await expect(row(tab)).toHaveCount(1, { timeout: 15_000 });
    }
    // Later pushes do not double the row or bring the placeholder back.
    await put(folder, "after-upload.txt");
    for (const tab of [uploader, watcher]) {
      await expect(tab.getByText("after-upload.txt", { exact: true }).first()).toBeVisible({
        timeout: PUSH_BOUND_MS,
      });
      await expect(row(tab)).toHaveCount(1);
    }
    const stored = await fetch(`${API}/files/users/${OWNER}/${enc(folder)}/${enc(name)}`, {
      method: "HEAD",
      headers: { Authorization: basicAuth() },
    });
    expect(stored.status).toBe(200);
    expect(Number(stored.headers.get("content-length"))).toBe(buffer.length);
  } finally {
    await context.close();
    await dav("DELETE", `${enc(folder)}/`).catch(() => undefined);
  }
});

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const folderUrl = (folder: string) =>
  `/drive?view=folder&path=${encodeURIComponent(`My Drive/${folder}`)}`;
const basicAuth = () => `Basic ${Buffer.from(`${OWNER}:${passwordFor(OWNER)}`).toString("base64")}`;

/** WebDAV, as a desktop client would. Retries a 429 so a write never flakes on the budget. */
async function dav(method: string, path: string, body?: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await fetch(`${API}/files/users/${OWNER}/${path}`, {
      method,
      headers: { Authorization: basicAuth(), "Content-Type": "text/plain" },
      body,
    });
    if (res.status !== 429) {
      if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

const put = (folder: string, name: string) =>
  dav("PUT", `${enc(folder)}/${enc(name)}`, `${name}\n`);

const isTasksChanges = (url: string) => url.includes("/api/v1/tasks/tasklists/changes");
/** The folder listing: `GET files/context` starts every `changeDir`. */
const isFolderListing = (url: string) => url.includes("/api/v1/files/context");

/** Resolves once none of the counters moved for 4 s (longer than the 3 s push interval). */
async function quiet(counters: Array<() => number>): Promise<void> {
  const read = () => counters.map((count) => count()).join(",");
  let last = read();
  let since = Date.now();
  await expect
    .poll(
      () => {
        const now = read();
        if (now !== last) {
          last = now;
          since = Date.now();
        }
        return Date.now() - since;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBeGreaterThanOrEqual(4_000);
}

function countRequests(tab: Page, matches: (url: string) => boolean): () => number {
  let count = 0;
  tab.on("request", (request) => {
    if (matches(request.url())) count += 1;
  });
  return () => count;
}

function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}

type HideableWindow = { __setHidden: (hidden: boolean) => void };

/** Every Playwright page counts as visible; this lets a test put one in the background. */
async function allowHiding(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    (window as unknown as HideableWindow).__setHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
}
