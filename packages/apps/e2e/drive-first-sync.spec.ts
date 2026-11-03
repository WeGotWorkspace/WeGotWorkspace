// Drive first sync on a new device (live app, #1727).
//
// Opening Drive on a fresh browser copies the drive for offline use in the
// background. That copy shares the account's request budget with every other
// app, so it must stay paced, leave room for a Tasks tab, never show a folder
// whose listing failed as empty, and not start over after a reload.
//
// Every test runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Page, type Request } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `First sync ${RUN}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const TEXT_FILES = Array.from({ length: 24 }, (_, i) => `Note ${RUN} ${pad(i + 1)}.md`);
const IMAGE_FILES = Array.from({ length: 8 }, (_, i) => `Photo ${RUN} ${pad(i + 1)}.png`);
const SEEDED = [...TEXT_FILES, ...IMAGE_FILES];
const LISTING_FAILED = /This folder could not be loaded/;

/** The background pacer allows 2 requests per second; a window may also hold a few previews. */
const MAX_BACKGROUND_REQUESTS_PER_10S = 25;

/** 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

/** WebDAV, as a desktop client would. Retries a 429 so seeding never flakes on the budget. */
async function dav(
  method: string,
  path: string,
  body?: Uint8Array<ArrayBuffer> | string,
  type?: string,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const headers: Record<string, string> = { Authorization: basicAuth };
    if (type) headers["Content-Type"] = type;
    const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
      method,
      headers,
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

async function seedFolder(): Promise<void> {
  const folder = encodeURIComponent(FOLDER);
  await dav("MKCOL", `${folder}/`);
  for (const [index, name] of TEXT_FILES.entries()) {
    const markdown = `# Note ${index + 1}\n\nSeeded by drive-first-sync (${RUN}).\n`;
    await dav("PUT", `${folder}/${encodeURIComponent(name)}`, markdown, "text/markdown");
  }
  for (const name of IMAGE_FILES) {
    await dav("PUT", `${folder}/${encodeURIComponent(name)}`, PNG, "image/png");
  }
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

/** Background sync requests: one file body each (content or collaboration snapshot). */
function backgroundSyncPath(request: Request): string | null {
  const url = new URL(request.url());
  if (url.pathname !== "/api/v1/files/content" && url.pathname !== "/api/v1/files/collaboration") {
    return null;
  }
  if (request.method() !== "GET") return null;
  return url.searchParams.get("path");
}

/** The seeded file a path names, or null. */
function seededName(path: string | null): string | null {
  if (!path) return null;
  const prefix = `/${FOLDER}/`;
  const at = path.indexOf(prefix);
  if (at < 0) return null;
  const name = path.slice(at + prefix.length);
  return SEEDED.includes(name) ? name : null;
}

type Seen = { at: number; path: string; seeded: string | null; collaboration: boolean };

function watchBackgroundSync(page: Page): Seen[] {
  const seen: Seen[] = [];
  page.on("request", (request) => {
    const path = backgroundSyncPath(request);
    if (path === null) return;
    seen.push({
      at: Date.now(),
      path,
      seeded: seededName(path),
      collaboration: request.url().includes("/files/collaboration"),
    });
  });
  return seen;
}

function maxPerWindow(times: number[], windowMs: number): number {
  let max = 0;
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end]! - times[start]! >= windowMs) start += 1;
    max = Math.max(max, end - start + 1);
  }
  return max;
}

/** Seeded files the offline store marks as synced (read straight from IndexedDB). */
async function syncedSeededFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (folder) => {
    const synced: string[] = [];
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
      if (db.objectStoreNames.contains("drive_availability")) {
        const rows = await new Promise<Array<{ id: string; lastSyncedAt: number | null }>>(
          (resolve) => {
            const get = db
              .transaction("drive_availability", "readonly")
              .objectStore("drive_availability")
              .getAll();
            get.onsuccess = () => resolve(get.result as never);
            get.onerror = () => resolve([]);
          },
        );
        for (const row of rows) {
          const at = row.id.indexOf(`/${folder}/`);
          if (row.lastSyncedAt && at >= 0) synced.push(row.id.slice(at + folder.length + 2));
        }
      }
      db.close();
    }
    return synced;
  }, FOLDER);
}

test.describe("Drive first sync on a new device", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await seedFolder();
  });

  test("paces the copy, leaves room for Tasks, and needs one request per text file", async ({
    page,
  }) => {
    const statuses: number[] = [];
    page.context().on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/")) statuses.push(response.status());
    });
    const seen = watchBackgroundSync(page);

    await page.goto("/drive");
    await expect(page.getByText(FOLDER, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // A second tab on Tasks, on the same account, while Drive copies.
    const tasks = await page.context().newPage();
    const taskLists = tasks.waitForResponse((response) =>
      response.url().includes("/api/v1/tasks/tasklists"),
    );
    await tasks.goto("/tasks");
    expect((await taskLists).status()).toBe(200);

    // Every seeded file is copied: text files with one request each.
    await expect
      .poll(() => new Set(seen.map((entry) => entry.seeded).filter(Boolean)).size, {
        timeout: 60_000,
      })
      .toBe(SEEDED.length);

    const probes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      probes.push(
        await tasks.evaluate(async () => {
          const token = localStorage.getItem("wgw.api.access_token");
          const res = await fetch("/api/v1/tasks/tasklists", {
            headers: { Authorization: `Bearer ${token}` },
          });
          return res.status;
        }),
      );
      await tasks.waitForTimeout(1000);
    }
    expect(probes).toEqual([200, 200, 200]);

    for (const name of TEXT_FILES) {
      const requests = seen.filter((entry) => entry.seeded === name);
      expect(requests, `${name}: one request`).toHaveLength(1);
      expect(requests[0]!.path).toBeTruthy();
      expect(requests[0]!.collaboration, `${name}: collaboration snapshot`).toBe(true);
    }
    for (const name of IMAGE_FILES) {
      expect(
        seen.filter((entry) => entry.seeded === name),
        `${name}: one request`,
      ).toHaveLength(1);
    }

    const perWindow = maxPerWindow(
      seen.map((entry) => entry.at),
      10_000,
    );
    expect(perWindow, "background file requests in any 10 s").toBeLessThanOrEqual(
      MAX_BACKGROUND_REQUESTS_PER_10S,
    );
    expect(statuses.filter((status) => status === 429)).toEqual([]);
    await tasks.close();
  });

  test("a reload mid-copy does not fetch the synced files again", async ({ page }) => {
    const before = watchBackgroundSync(page);
    await page.goto("/drive");

    let syncedBeforeReload: string[] = [];
    await expect
      .poll(
        async () => {
          syncedBeforeReload = await syncedSeededFiles(page);
          return syncedBeforeReload.length;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(6);
    expect(syncedBeforeReload.length, "reloaded mid-copy").toBeLessThan(SEEDED.length);
    const requestedBeforeReload = before.length;

    const after: Seen[] = [];
    page.on("request", (request) => {
      const path = backgroundSyncPath(request);
      if (path !== null)
        after.push({ at: Date.now(), path, seeded: seededName(path), collaboration: false });
    });
    await page.reload();

    // The copy resumes and finishes...
    await expect
      .poll(async () => (await syncedSeededFiles(page)).length, { timeout: 60_000 })
      .toBe(SEEDED.length);
    expect(requestedBeforeReload).toBeGreaterThan(0);
    // ...without fetching a file it already had.
    const refetched = after
      .map((entry) => entry.seeded)
      .filter((name): name is string => name !== null && syncedBeforeReload.includes(name));
    expect(refetched).toEqual([]);
  });

  test("a folder whose listing fails shows an error and recovers by itself", async ({ page }) => {
    const parentId = await folderNodeId();
    let refusing = true;
    let refused = 0;
    await page.route("**/api/v1/jmap", async (route) => {
      const body = route.request().postData() ?? "";
      if (refusing && body.includes(`"parentId":"${parentId}"`)) {
        refused += 1;
        return route.fulfill({
          status: 429,
          headers: { "Retry-After": "1", "Content-Type": "application/problem+json" },
          body: JSON.stringify({ type: "about:blank", status: 429, detail: "Too many requests." }),
        });
      }
      return route.continue();
    });

    await page.goto(FOLDER_URL);
    await expect(page.getByText(LISTING_FAILED)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This folder is empty")).toHaveCount(0);
    expect(refused).toBeGreaterThan(0);

    // The server recovers; the listing retries on its own.
    refusing = false;
    await expect(page.getByText(TEXT_FILES[0]!, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(LISTING_FAILED)).toHaveCount(0);
  });

  test("Try again loads a folder whose listing failed", async ({ page }) => {
    const parentId = await folderNodeId();
    let refusing = true;
    let refused = 0;
    await page.route("**/api/v1/jmap", async (route) => {
      const body = route.request().postData() ?? "";
      if (refusing && body.includes(`"parentId":"${parentId}"`)) {
        refused += 1;
        return route.fulfill({
          status: 429,
          headers: { "Retry-After": "1", "Content-Type": "application/problem+json" },
          body: JSON.stringify({ type: "about:blank", status: 429, detail: "Too many requests." }),
        });
      }
      return route.continue();
    });

    await page.goto(FOLDER_URL);
    await expect(page.getByText(LISTING_FAILED)).toBeVisible({ timeout: 30_000 });
    // The first automatic retry fails too; the next one is seconds away.
    const refusedAtError = refused;
    await expect.poll(() => refused, { timeout: 10_000 }).toBeGreaterThan(refusedAtError);
    await expect(page.getByText(LISTING_FAILED)).toBeVisible();
    await expect(page.getByText("This folder is empty")).toHaveCount(0);

    refusing = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(TEXT_FILES[0]!, { exact: true }).first()).toBeVisible({
      timeout: 2_500,
    });
    await expect(page.getByText(LISTING_FAILED)).toHaveCount(0);
  });

  test("row spinners follow the first copy: only files still to copy spin", async ({ browser }) => {
    const rowFolder = `Row state ${RUN}`;
    const rowUrl = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${rowFolder}`)}`;
    const small = Array.from({ length: 16 }, (_, i) => `Small ${RUN} ${pad(i + 1)}.md`);
    const big = `Big ${RUN}.bin`;
    const uploaded = `Upl ${RUN}.md`;
    const folder = encodeURIComponent(rowFolder);
    await dav("MKCOL", `${folder}/`);
    for (const name of small) {
      await dav("PUT", `${folder}/${encodeURIComponent(name)}`, `# ${name}\n`, "text/markdown");
    }
    await dav(
      "PUT",
      `${folder}/${encodeURIComponent(big)}`,
      new Uint8Array(2 * 1024 * 1024),
      "application/octet-stream",
    );

    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (!localStorage.getItem("wgw.offline.deviceContentSettings")) {
        localStorage.setItem(
          "wgw.offline.deviceContentSettings",
          JSON.stringify({ contentSyncEnabled: true, maxFileSizeBytes: 1024 * 1024 }),
        );
      }
    });
    const page = await context.newPage();
    const spinner = page.getByRole("button", { name: "Downloading for offline use" });
    const row = (name: string) => {
      const others = [...small, big, uploaded]
        .filter((other) => other !== name)
        .map((other) => other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return page
        .locator("div,li,tr")
        .filter({ has: page.getByText(name, { exact: true }) })
        .filter({ hasNotText: new RegExp(others.join("|")) })
        .first();
    };
    const syncedInFolder = async () => {
      const entries = await page.evaluate(async (name) => {
        const out: string[] = [];
        for (const info of await indexedDB.databases()) {
          if (!info.name?.startsWith("wgw-offline-")) continue;
          const db = await new Promise<IDBDatabase | null>((resolve) => {
            const request = indexedDB.open(info.name!);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
          if (!db) continue;
          if (db.objectStoreNames.contains("drive_availability")) {
            const rows = await new Promise<Array<{ id: string; lastSyncedAt: number | null }>>(
              (resolve) => {
                const get = db
                  .transaction("drive_availability", "readonly")
                  .objectStore("drive_availability")
                  .getAll();
                get.onsuccess = () => resolve(get.result as never);
                get.onerror = () => resolve([]);
              },
            );
            for (const r of rows) {
              const at = r.id.indexOf(`/${name}/`);
              if (r.lastSyncedAt && at >= 0) out.push(r.id.slice(at + name.length + 2));
            }
          }
          db.close();
        }
        return out;
      }, rowFolder);
      return entries;
    };

    try {
      await page.goto(rowUrl);
      await expect(page.getByText(small[0]!, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // The oversized file is offered, not spinning, while the copy runs.
      await expect(row(big).getByRole("button", { name: "Make available offline" })).toBeEnabled({
        timeout: 30_000,
      });
      // Not every row spins: the big file never does.
      expect(await spinner.count()).toBeLessThan(small.length + 1);

      // A file added during the run is not queued by it: no spinner.
      await page.getByLabel("Upload files").setInputFiles({
        name: uploaded,
        mimeType: "text/markdown",
        buffer: Buffer.from("# uploaded\n"),
      });
      await expect(page.getByText(uploaded, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        row(uploaded).getByRole("button", { name: "Downloading for offline use" }),
      ).toHaveCount(0);

      // A stored file stops spinning without a reload.
      let first = "";
      await expect
        .poll(
          async () => {
            first = (await syncedInFolder()).find((name) => small.includes(name)) ?? "";
            return first;
          },
          { timeout: 60_000, intervals: [250] },
        )
        .not.toBe("");
      await expect(
        row(first).getByRole("button", { name: "Downloading for offline use" }),
      ).toHaveCount(0, { timeout: 10_000 });

      // When the copy is done, nothing spins.
      await expect
        .poll(async () => (await syncedInFolder()).filter((n) => small.includes(n)).length, {
          timeout: 90_000,
        })
        .toBe(small.length);
      // A later pass may still copy the file uploaded mid-run; then it settles too.
      await expect(spinner).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });
});
