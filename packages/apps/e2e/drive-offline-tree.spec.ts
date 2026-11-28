// Drive on the device's file tree, production build (#2063 C6).
//
// After one online visit, the service worker serves the app and the tree holds
// the whole drive, so Drive opens with its rows at once: online without a
// spinner or a folder listing, and offline in a new tab, Starred and Shared
// with me included. A row the person shares carries its badge from the stored
// copy, offline too. A folder the device never synced says so instead of
// looking empty. Runs on `vite preview` through `playwright.pwa.config.mjs`:
// the dev server has no service worker, so it cannot open a tab offline.
import { type BrowserContext, expect, type Page, test } from "./helpers/live-test";
import {
  api,
  makeFolder,
  putDoc,
  removeQuietly,
  TEAMMATE,
  unshareQuietly,
} from "./helpers/docs-matrix";
import { jmapFileNodes } from "./helpers/drive-upload-live";
import { E2E_USERNAME } from "./helpers/notes-live";

const RUN = Date.now().toString(36);
const HOME = `/users/${E2E_USERNAME}`;
const FOLDER = `Tree offline ${RUN}`;
const FILE = `tree-plain-${RUN}.md`;
const STARRED = `tree-starred-${RUN}.md`;
/** The E2E user's own file, shared with the teammate: its row shows the badge. */
const OUTBOUND = `tree-outbound-${RUN}.md`;
const OUTBOUND_PATH = `${HOME}/${FOLDER}/${OUTBOUND}`;
/** The teammate's file, shared with the E2E user: it is in Shared with me. */
const INBOUND = `tree-inbound-${RUN}.md`;
const INBOUND_PATH = `/users/${TEAMMATE}/${INBOUND}`;

const NOT_AVAILABLE = "Not available offline yet";

function folderUrl(uiPath: string): string {
  return `/drive?view=folder&path=${encodeURIComponent(uiPath)}`;
}

function row(page: Page, name: string) {
  return page.getByText(name, { exact: true }).first();
}

/** The list row or grid tile around a name (the element that holds its actions). */
function rowOf(page: Page, name: string) {
  return row(page, name).locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
}

async function star(page: Page, name: string): Promise<void> {
  await rowOf(page, name).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Star", exact: true }).click();
}

/** True once the first sync on this device finished (the walk's last-pass marker in IndexedDB). */
async function firstSyncDone(page: Page): Promise<boolean> {
  return page.evaluate(async (user) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(`wgw-offline-${user}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("meta")) return false;
    const key = await new Promise<IDBValidKey | undefined>((resolve) => {
      const get = db.transaction("meta").objectStore("meta").getKey("drive:tree-sync:last-pass");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => resolve(undefined);
    });
    db.close();
    return key !== undefined;
  }, E2E_USERNAME);
}

/** Records, from document start, whether the full-pane loading state ever showed. */
async function watchForLoading(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const seen = () => {
      if (document.querySelector(".collection-state--loading")) {
        (window as unknown as { __sawLoading?: boolean }).__sawLoading = true;
      }
    };
    new MutationObserver(seen).observe(document, { subtree: true, childList: true });
  });
}

async function sawLoading(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __sawLoading?: boolean }).__sawLoading === true,
  );
}

/**
 * Listing requests a page sends, by kind: the tree walk, the search route, a
 * folder listing (`parentId:<id>`) or the top-level roots lookup. The app's
 * start-up still looks up the roots and lists the home root once in the
 * background; a view must not list.
 */
function watchListings(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/search/results")) seen.push("search");
    if (!url.pathname.endsWith("/jmap")) return;
    type Call = [string, Record<string, unknown>, string];
    let calls: Call[] = [];
    try {
      calls =
        (JSON.parse(request.postData() ?? "{}") as { methodCalls?: Call[] }).methodCalls ?? [];
    } catch {
      return;
    }
    for (const [name, args] of calls) {
      if (name !== "FileNode/query") continue;
      const filter = (args.filter ?? null) as Record<string, unknown> | null;
      if (["idAfter", "#idAfter", "asOfState", "#asOfState"].some((key) => key in args)) {
        seen.push("walk");
      } else if (typeof filter?.parentId === "string") {
        seen.push(`parentId:${filter.parentId}`);
      } else {
        seen.push("roots");
      }
    }
  });
  return seen;
}

test.describe("Drive on the file tree, production build", () => {
  test.beforeAll(async () => {
    await makeFolder(E2E_USERNAME, `${HOME}/${FOLDER}`);
    for (const name of [FILE, STARRED, OUTBOUND]) {
      await putDoc(E2E_USERNAME, `${HOME}/${FOLDER}/${name}`, `# ${name}\n`);
    }
    const outbound = await api(E2E_USERNAME, "POST", "/files/shares", {
      path: OUTBOUND_PATH,
      kind: "member",
      defaultAccess: "view",
      shareWith: { [TEAMMATE]: { access: "view" } },
    });
    if (outbound.status >= 300)
      throw new Error(`share ${OUTBOUND}: ${JSON.stringify(outbound.json)}`);
    await putDoc(TEAMMATE, INBOUND_PATH, `# ${INBOUND}\n`);
    const inbound = await api(TEAMMATE, "POST", "/files/shares", {
      path: INBOUND_PATH,
      kind: "member",
      defaultAccess: "view",
      shareWith: { [E2E_USERNAME]: { access: "view" } },
    });
    if (inbound.status >= 300) throw new Error(`share ${INBOUND}: ${JSON.stringify(inbound.json)}`);
  });

  test.afterAll(async () => {
    await unshareQuietly(E2E_USERNAME, OUTBOUND_PATH);
    await unshareQuietly(TEAMMATE, INBOUND_PATH);
    await removeQuietly(E2E_USERNAME, [`${HOME}/${FOLDER}/`]);
    await removeQuietly(TEAMMATE, [INBOUND_PATH]);
  });

  test("warm online open, cold offline open, Starred, Shared, a never-synced folder, a shared badge", async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);
    await watchForLoading(context);

    // A new device: the first visit syncs the tree and installs the worker.
    await page.goto(folderUrl(`My Drive/${FOLDER}`));
    await expect(row(page, FILE)).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(() => firstSyncDone(page), { timeout: 180_000, intervals: [2_000] })
      .toBe(true);
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
      timeout: 60_000,
    });
    const found = await jmapFileNodes(page, "FileNode/query", { filter: { name: FOLDER } });
    const folderId = (found.ids as string[])[0]!;
    expect(folderId, `${FOLDER} on the server`).toBeTruthy();
    await star(page, STARRED);
    await expect(rowOf(page, OUTBOUND).getByRole("img", { name: "Shared" })).toBeVisible();

    // Warm online open in a new tab: rows at once, no spinner, no listing request.
    const warm = await context.newPage();
    const listings = watchListings(warm);
    await warm.goto(folderUrl(`My Drive/${FOLDER}`));
    await expect(row(warm, FILE)).toBeVisible({ timeout: 15_000 });
    await expect(rowOf(warm, OUTBOUND).getByRole("img", { name: "Shared" })).toBeVisible();
    await warm.goto("/drive?view=starred");
    await expect(row(warm, STARRED)).toBeVisible({ timeout: 15_000 });
    // A listing sent after the rows show counts too. The push stream keeps a
    // request open, so the network never goes idle: watch a fixed while instead.
    await warm.waitForTimeout(5_000);
    expect(await sawLoading(warm)).toBe(false);
    expect(
      listings.filter((kind) => ["walk", "search", `parentId:${folderId}`].includes(kind)),
    ).toEqual([]);

    // Cold offline open: every tab closed, the network gone, then a new tab.
    for (const open of context.pages()) await open.close();
    await context.setOffline(true);
    try {
      const cold = await context.newPage();
      await cold.goto(folderUrl(`My Drive/${FOLDER}`));
      await expect(cold.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 30_000 });
      await expect(row(cold, FILE)).toBeVisible({ timeout: 30_000 });
      await expect(row(cold, STARRED)).toBeVisible();
      // The badge comes from the stored entry: no server answers now.
      await expect(rowOf(cold, OUTBOUND).getByRole("img", { name: "Shared" })).toBeVisible();
      // Offline, the app's start-up read falls back to the stored copy a moment
      // later than online, and the pane can show its loading state for that
      // moment (about 15 ms here); it never stays once the rows are in.
      await expect(cold.locator(".collection-state--loading")).toHaveCount(0);

      // Starred and Shared with me, offline.
      await cold.goto("/drive?view=starred");
      await expect(row(cold, STARRED)).toBeVisible({ timeout: 30_000 });
      await expect(cold.getByText(FILE, { exact: true })).toHaveCount(0);
      await cold.goto("/drive?view=shared");
      await expect(row(cold, INBOUND)).toBeVisible({ timeout: 30_000 });

      // A folder this device never synced is not available, never empty.
      await cold.goto(folderUrl(`My Drive/Never synced ${RUN}`));
      await expect(cold.getByText(NOT_AVAILABLE)).toBeVisible({ timeout: 30_000 });
      await expect(cold.getByText("This folder is empty")).toHaveCount(0);
      await expect(cold.getByText("Loading…")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});
