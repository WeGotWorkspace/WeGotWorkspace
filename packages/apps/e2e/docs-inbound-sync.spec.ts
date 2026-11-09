// Docs inbound reconciliation (live app, #1563).
//
// A Doc deleted, renamed or moved (its folder renamed) from outside the tab
// (WebDAV, as a desktop client would) leaves or moves in every cached Docs
// home view on the next sync, without a reload. A Doc with a queued offline rename is not
// dropped by that sync, nor by the next full live listing.
import { expect, test, type Page } from "./helpers/live-test";
import { cachedDocsViews, docsHomeRow, gotoDocsHome, seedDocAtPath } from "./helpers/docs-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const HOME = `/users/${E2E_USERNAME}`;
// Fresh names per attempt, so a retry never meets the last attempt's files.
let RUN = "";
let DELETED = "";
let RENAMED_FROM = "";
let RENAMED_TO = "";
let MOVED = "";
let FOLDER_FROM = "";
let FOLDER_TO = "";
let QUEUED_FROM = "";
let QUEUED_BASE = "";
let QUEUED_TO = "";

function nameThisAttempt(): void {
  RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  DELETED = `Inbound delete ${RUN}.md`;
  RENAMED_FROM = `Inbound rename ${RUN}.md`;
  RENAMED_TO = `Inbound renamed ${RUN}.md`;
  MOVED = `Inbound move ${RUN}.md`;
  FOLDER_FROM = `Inbound folder ${RUN}`;
  FOLDER_TO = `Inbound folder moved ${RUN}`;
  QUEUED_FROM = `Inbound queued ${RUN}.md`;
  QUEUED_BASE = `Inbound queued local ${RUN}`;
  QUEUED_TO = `${QUEUED_BASE}.md`;
}

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;
const davUrl = (apiPath: string) =>
  `${API}/files/${apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

/** WebDAV from outside the tab. Retries a 429 so the run never flakes on the budget. */
async function dav(method: string, apiPath: string, headers: Record<string, string> = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await fetch(davUrl(apiPath), {
      method,
      headers: { Authorization: basicAuth, ...headers },
    });
    if (res.status !== 429) {
      if (!res.ok) throw new Error(`${method} ${apiPath} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${apiPath} stayed rate limited`);
}

const moveOnServer = (from: string, to: string) =>
  dav("MOVE", from, { Destination: davUrl(to), Overwrite: "F" });

/** Clean-up: delete what a test seeded, whatever state the test left it in. */
async function deleteQuietly(apiPaths: readonly string[]): Promise<void> {
  for (const apiPath of apiPaths) {
    await dav("DELETE", apiPath).catch(() => undefined);
  }
}

/** The Drive cache knows a node at this path (the first FileNode inbound ran). */
async function driveCacheHas(page: Page, apiPath: string): Promise<boolean> {
  return page.evaluate(
    async (id) => {
      const username = localStorage.getItem("wgw.offline.docs.username");
      if (!username) return false;
      return new Promise<boolean>((resolve) => {
        const request = indexedDB.open(`wgw-offline-${username}`);
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("drive_entries")) return resolve(false);
          const get = db.transaction("drive_entries", "readonly").objectStore("drive_entries");
          const read = get.getAll();
          read.onsuccess = () =>
            resolve(
              (read.result as Array<{ id: string; nodeId?: string }>).some(
                (row) => row.id.replace(/^\/+/, "") === id && Boolean(row.nodeId),
              ),
            );
          read.onerror = () => resolve(false);
        };
      });
    },
    apiPath.replace(/^\/+/, ""),
  );
}

function sidebarView(page: Page, name: string) {
  return page.locator(".docs-workspace").getByRole("button", { name, exact: true }).first();
}

async function openView(page: Page, name: string): Promise<void> {
  await sidebarView(page, name).click();
}

/** Rename a Doc from its row menu, as the user does. */
async function renameFromRow(page: Page, fileName: string, nextBase: string): Promise<void> {
  const row = docsHomeRow(page, fileName);
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename document" });
  await dialog.getByRole("textbox").fill(nextBase);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
}

type Blocks = { search: boolean; writes: boolean };

/** Hold the live listing and the queued rename's server write, each on demand. */
async function holdServer(page: Page, blocks: Blocks): Promise<void> {
  await page.route("**/api/v1/search/results**", (route) =>
    blocks.search ? route.abort("failed") : route.continue(),
  );
  await page.route("**/api/v1/jmap", (route) => {
    const body = route.request().postData() ?? "";
    if (blocks.writes && body.includes("FileNode/set")) {
      return route.fulfill({ status: 503, body: "held by the test" });
    }
    return route.continue();
  });
}

test.describe("Docs inbound sync (#1563)", () => {
  test.beforeEach(nameThisAttempt);

  test("a second tab follows changes that another tab pulled, without a reload", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    const seeded = [DELETED, RENAMED_FROM].map((name) => `${HOME}/${name}`);
    try {
      for (const apiPath of seeded) await seedDocAtPath(apiPath, "# Seeded by #1563.\n");

      // Tab A: both Docs listed, and the Drive cache knows both nodes.
      await gotoDocsHome(page);
      await openView(page, "My Docs");
      for (const name of [DELETED, RENAMED_FROM]) {
        await expect(docsHomeRow(page, name)).toBeVisible({ timeout: 30_000 });
      }
      for (const apiPath of seeded) {
        await expect.poll(() => driveCacheHas(page, apiPath), { timeout: 60_000 }).toBe(true);
      }

      // Tab B: the same view. Its live listing is held from now on, so only
      // the cache notice from tab A can change what it shows.
      const tabB = await context.newPage();
      await gotoDocsHome(tabB);
      await openView(tabB, "My Docs");
      for (const name of [DELETED, RENAMED_FROM]) {
        await expect(docsHomeRow(tabB, name)).toBeVisible({ timeout: 30_000 });
      }
      await tabB.route("**/api/v1/search/results**", (route) => route.abort("failed"));

      // Another device deletes one Doc and renames the other.
      await dav("DELETE", `${HOME}/${DELETED}`);
      await moveOnServer(`${HOME}/${RENAMED_FROM}`, `${HOME}/${RENAMED_TO}`);

      // Tab A reloads. Its start-up FileNode inbound and its live listing both
      // pull the changes; whichever writes the cache first tells tab B.
      await page.reload();
      await expect(docsHomeRow(page, RENAMED_TO)).toBeVisible({ timeout: 30_000 });

      // Tab B follows without a reload.
      await expect(docsHomeRow(tabB, DELETED)).toHaveCount(0, { timeout: 30_000 });
      await expect(docsHomeRow(tabB, RENAMED_FROM)).toHaveCount(0);
      await expect(docsHomeRow(tabB, RENAMED_TO)).toBeVisible();
    } finally {
      await deleteQuietly([...seeded, `${HOME}/${RENAMED_TO}`]);
    }
  });

  test("outside deletes, renames and moves reach every cached view; a queued rename stays", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    for (const name of [DELETED, RENAMED_FROM, QUEUED_FROM]) {
      await seedDocAtPath(`${HOME}/${name}`, `# ${name}\n\nSeeded by #1563.\n`);
    }
    await dav("MKCOL", `${HOME}/${FOLDER_FROM}/`);
    await seedDocAtPath(`${HOME}/${FOLDER_FROM}/${MOVED}`, `# ${MOVED}\n`);

    // Two views cached: Personal (My Drive), then My Docs (All).
    await gotoDocsHome(page);
    await openView(page, "Personal");
    for (const name of [DELETED, RENAMED_FROM, MOVED, QUEUED_FROM]) {
      await expect(docsHomeRow(page, name)).toBeVisible({ timeout: 30_000 });
    }
    await openView(page, "My Docs");
    for (const name of [DELETED, RENAMED_FROM, MOVED, QUEUED_FROM]) {
      await expect(docsHomeRow(page, name)).toBeVisible({ timeout: 30_000 });
    }
    // The first FileNode inbound gave the Drive cache every seeded node.
    const seeded = [DELETED, RENAMED_FROM, `${FOLDER_FROM}/${MOVED}`, QUEUED_FROM];
    for (const name of seeded) {
      await expect
        .poll(() => driveCacheHas(page, `${HOME}/${name}`), { timeout: 60_000 })
        .toBe(true);
    }

    // Offline: rename one Doc in this tab. It waits in the outbox.
    const blocks: Blocks = { search: false, writes: true };
    await holdServer(page, blocks);
    await context.setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 15_000 });
    await renameFromRow(page, QUEUED_FROM, QUEUED_BASE);
    await expect(docsHomeRow(page, QUEUED_TO)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_FROM)).toHaveCount(0);

    // Meanwhile, another device changes four Docs.
    await dav("DELETE", `${HOME}/${DELETED}`);
    await moveOnServer(`${HOME}/${RENAMED_FROM}`, `${HOME}/${RENAMED_TO}`);
    await moveOnServer(`${HOME}/${FOLDER_FROM}`, `${HOME}/${FOLDER_TO}`);
    await seedDocAtPath(`${HOME}/${QUEUED_FROM}`, `# ${QUEUED_FROM}\n\nEdited elsewhere.\n`);

    // Back online. The live listing stays held, so only the FileNode inbound
    // can change what the views show. The queued rename's write fails (503).
    blocks.search = true;
    await context.setOffline(false);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 15_000 });

    // My Docs follows without a reload.
    await expect(docsHomeRow(page, DELETED)).toHaveCount(0, { timeout: 30_000 });
    await expect(docsHomeRow(page, RENAMED_FROM)).toHaveCount(0);
    await expect(docsHomeRow(page, RENAMED_TO)).toBeVisible();
    await expect(docsHomeRow(page, MOVED)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_TO)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_FROM)).toHaveCount(0);

    // Both cached views hold the moved folder's Doc at its new path.
    const home = HOME.slice(1);
    await expect
      .poll(async () =>
        (await cachedDocsViews(page))
          .filter((keys) => keys.includes(`${home}/${RENAMED_TO}`))
          .map((keys) => keys.filter((key) => key.includes(RUN)).sort()),
      )
      .toEqual(
        Array(2).fill(
          [`${home}/${FOLDER_TO}/${MOVED}`, `${home}/${QUEUED_TO}`, `${home}/${RENAMED_TO}`].sort(),
        ),
      );

    // Personal, read from its cache (the live listing is still held).
    await openView(page, "Personal");
    await expect(docsHomeRow(page, RENAMED_TO)).toBeVisible({ timeout: 30_000 });
    await expect(docsHomeRow(page, DELETED)).toHaveCount(0);
    await expect(docsHomeRow(page, RENAMED_FROM)).toHaveCount(0);
    await expect(docsHomeRow(page, MOVED)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_TO)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_FROM)).toHaveCount(0);

    // Let the full live listing through. It does not list the queued name
    // yet (the server still has the old one), and must not drop it.
    blocks.search = false;
    const listed = page.waitForResponse(
      (res) => res.url().includes("/api/v1/search/results") && res.ok(),
    );
    await openView(page, "My Docs");
    await listed;
    await expect(docsHomeRow(page, RENAMED_TO)).toBeVisible({ timeout: 30_000 });
    await expect(docsHomeRow(page, QUEUED_TO)).toBeVisible();
    await expect(docsHomeRow(page, QUEUED_FROM)).toHaveCount(0);
    await expect(docsHomeRow(page, DELETED)).toHaveCount(0);
  });
});
