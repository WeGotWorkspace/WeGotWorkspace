// Drive inbound sync with more than 500 files (live app, #1780).
//
// A fresh device fetches every FileNode id the account holds. The server caps
// FileNode/get at maxObjectsInGet (500), so one request for all ids failed
// with requestTooLarge and the offline cache stayed empty. The sync must chunk
// the ids and keep the cache current across later renames and deletes.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `Many files ${RUN}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const FILE_COUNT = 520;
const MAX_OBJECTS_IN_GET = 500;
const FILES = Array.from(
  { length: FILE_COUNT },
  (_, i) => `File ${RUN} ${String(i + 1).padStart(3, "0")}.txt`,
);
const RENAME_FROM = FILES[0]!;
const RENAME_TO = `Aaa renamed ${RUN}.txt`;
const DELETED = FILES[1]!;

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;
const davUrl = (path: string) => `${API}/files/users/${E2E_USERNAME}/${path}`;

/** WebDAV, as a desktop client would. Retries a 429 so seeding never flakes on the budget. */
async function dav(
  method: string,
  path: string,
  body?: string,
  extra: Record<string, string> = {},
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await fetch(davUrl(path), {
      method,
      headers: { Authorization: basicAuth, ...extra },
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
  for (let at = 0; at < FILES.length; at += 8) {
    await Promise.all(
      FILES.slice(at, at + 8).map((name) =>
        dav("PUT", `${folder}/${encodeURIComponent(name)}`, `seeded ${RUN}\n`, {
          "Content-Type": "text/plain",
        }),
      ),
    );
  }
}

type Seen = { fileNodeGets: number[]; changes: number; warnings: string[] };

function watchSync(page: Page): Seen {
  const seen: Seen = { fileNodeGets: [], changes: 0, warnings: [] };
  page.on("console", (message) => seen.warnings.push(message.text()));
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
    let calls: Array<[string, { ids?: unknown }]> = [];
    try {
      calls =
        (JSON.parse(request.postData() ?? "{}") as { methodCalls?: typeof calls }).methodCalls ??
        [];
    } catch {
      return;
    }
    for (const [name, args] of calls) {
      if (name === "FileNode/changes") seen.changes += 1;
      if (name === "FileNode/get" && Array.isArray(args.ids))
        seen.fileNodeGets.push(args.ids.length);
    }
  });
  return seen;
}

const idsFetched = (seen: Seen) => seen.fileNodeGets.reduce((sum, n) => sum + n, 0);

test.describe("Drive inbound sync with more than 500 files", () => {
  test("chunks FileNode/get and keeps the offline listing current", async ({ page }) => {
    test.setTimeout(240_000);
    await seedFolder();

    const seen = watchSync(page);
    await page.goto("/drive");
    await expect(page.getByText(FOLDER, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => idsFetched(seen), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(FILE_COUNT);
    await page.waitForTimeout(3_000);

    // Another device renames one file and deletes another.
    const folder = encodeURIComponent(FOLDER);
    await dav("MOVE", `${folder}/${encodeURIComponent(RENAME_FROM)}`, undefined, {
      Destination: davUrl(`${folder}/${encodeURIComponent(RENAME_TO)}`),
    });
    await dav("DELETE", `${folder}/${encodeURIComponent(DELETED)}`);

    // The next inbound sync runs on app start.
    const changesBefore = seen.changes;
    const getsBefore = seen.fileNodeGets.length;
    await page.reload();
    await expect.poll(() => seen.changes, { timeout: 30_000 }).toBeGreaterThan(changesBefore);
    await expect
      .poll(() => seen.fileNodeGets.length, { timeout: 30_000 })
      .toBeGreaterThan(getsBefore);
    await page.waitForTimeout(3_000);

    // Warnings from the online syncs only: blocking the API below makes later syncs fail.
    const onlineWarnings = [...seen.warnings];

    // Offline: the listing comes from the cache the sync wrote.
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
    await expect(page.getByText(RENAME_TO, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(RENAME_FROM, { exact: true })).toHaveCount(0);
    await expect(page.getByText(DELETED, { exact: true })).toHaveCount(0);

    expect(onlineWarnings.filter((text) => text.includes("FileNode sync failed"))).toEqual([]);
    expect(onlineWarnings.filter((text) => text.includes("requestTooLarge"))).toEqual([]);
    expect(Math.max(...seen.fileNodeGets)).toBeLessThanOrEqual(MAX_OBJECTS_IN_GET);
  });
});
