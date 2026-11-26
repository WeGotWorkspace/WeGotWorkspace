// A file written while Drive's first sync runs is not lost (live app, #2063 C1).
//
// The first sync takes its FileNode state before it lists anything, so a file
// another device adds to a folder the sync has already listed is reported by
// the next FileNode/changes. Opening Drive later runs changes only: if the
// state were taken after the listing, that file would stay missing offline.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `During sync ${RUN}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const ADDED = `Added during sync ${RUN}.md`;
const SEED = `Seed ${RUN}.md`;
const FILLER_FOLDERS = Array.from({ length: 8 }, (_, i) => `Zfill ${RUN} ${i + 1}`);
const FILLER_FILES = 6;
const SYNC_STATE_KEY = "drive:file-node-sync-state";

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

/** WebDAV, as a desktop client would. Retries a 429 so seeding never flakes on the budget. */
async function dav(method: string, path: string, body?: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
      method,
      headers: { Authorization: basicAuth, "Content-Type": "text/markdown" },
      body,
    });
    if (res.status !== 429) {
      // 405 on MKCOL: the folder exists already (a retried run).
      const exists = method === "MKCOL" && res.status === 405;
      if (!res.ok && !exists) throw new Error(`${method} ${path} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

/** The FileNode id of the seeded folder: its listing filters on it. */
async function folderNodeId(): Promise<string> {
  const token = (await (
    await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
    })
  ).json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${token.access_token}` };
  const session = (await (await fetch(`${API}/api/v1/jmap/session`, { headers: auth })).json()) as {
    primaryAccounts: Record<string, string>;
  };
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:filenode"];
  const res = await fetch(`${API}/api/v1/jmap`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:filenode"],
      methodCalls: [["FileNode/query", { accountId, filter: { name: FOLDER } }, "q"]],
    }),
  });
  const body = (await res.json()) as { methodResponses: Array<[string, { ids?: string[] }]> };
  const id = body.methodResponses[0]?.[1].ids?.[0];
  if (!id) throw new Error(`No FileNode for ${FOLDER} (${res.status})`);
  return id;
}

/** True once the first sync has stored its FileNode state (read straight from IndexedDB). */
async function syncStateStored(page: Page): Promise<boolean> {
  return page.evaluate(async (key) => {
    const databases = (await indexedDB.databases())
      .map((entry) => entry.name ?? "")
      .filter((name) => name.startsWith("wgw-offline-"));
    for (const name of databases) {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      let found = false;
      if (db.objectStoreNames.contains("meta")) {
        found = await new Promise<boolean>((resolve) => {
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key);
          get.onsuccess = () => resolve(get.result !== undefined);
          get.onerror = () => resolve(false);
        });
      }
      db.close();
      if (found) return true;
    }
    return false;
  }, SYNC_STATE_KEY);
}

test.describe("Drive first sync with a concurrent write", () => {
  test("a file added to an already listed folder during the first sync is stored", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const folder = encodeURIComponent(FOLDER);
    await dav("MKCOL", `${folder}/`);
    await dav("PUT", `${folder}/${encodeURIComponent(SEED)}`, `# Seed ${RUN}\n`);
    for (const name of FILLER_FOLDERS) {
      await dav("MKCOL", `${encodeURIComponent(name)}/`);
      for (let i = 0; i < FILLER_FILES; i += 1) {
        await dav("PUT", `${encodeURIComponent(name)}/f${i}.md`, `# ${name} ${i}\n`);
      }
    }
    const parentId = await folderNodeId();

    let lastListingAt = 0;
    page.on("request", (request) => {
      const body = request.postData() ?? "";
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/jmap") &&
        body.includes("FileNode/query")
      ) {
        lastListingAt = Date.now();
      }
    });
    // The listing of the seeded folder, answered while the first sync still runs.
    const seededListed = page.waitForResponse((response) => {
      const request = response.request();
      const body = request.postData() ?? "";
      return (
        request.method() === "POST" &&
        response.url().endsWith("/api/v1/jmap") &&
        body.includes("FileNode/query") &&
        body.includes(`"${parentId}"`)
      );
    });

    // My Drive only: the seeded folder is not opened.
    await page.goto("/drive?view=folder&path=My%20Drive");
    await seededListed;
    await dav("PUT", `${folder}/${encodeURIComponent(ADDED)}`, `# Added ${RUN}\n`);

    // The first sync is done: its state is stored and no more listings go out.
    await expect
      .poll(() => syncStateStored(page), { timeout: 120_000, intervals: [500] })
      .toBe(true);
    await expect
      .poll(() => Date.now() - lastListingAt, { timeout: 60_000, intervals: [500] })
      .toBeGreaterThan(5_000);

    // Reopen online: changes only.
    await page.reload();
    await page.waitForTimeout(5_000);

    // Offline: the folder lists what the sync stored.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "HEAD" && url.pathname === "/") return route.abort("failed");
      if (url.pathname.includes("/api/v1/")) return route.abort("failed");
      return route.continue();
    });
    await page.goto(FOLDER_URL);
    await expect(page.getByText(SEED, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(ADDED, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  });
});
