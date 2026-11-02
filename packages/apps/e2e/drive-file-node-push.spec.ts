import { expect, test, type BrowserContext, type Page, type Request } from "./helpers/live-test";
import { docsHomeRow } from "./helpers/docs-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

/**
 * #1663: a change made elsewhere (WebDAV, as a desktop client would) reaches an
 * open Drive folder and the Docs home on push, with no reload, in two tabs of
 * one browser, with one `FileNode/changes` for the whole browser per write.
 * Then the tab that held the stream reloads, and the same holds again.
 *
 * Bound: 8 s. Drive has no folder poll, so a row that appears without a reload
 * is the push path.
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
const FOLDER = `Push ${RUN}`;
const FOLDER_URL = `/drive?view=folder&path=${encodeURIComponent(`My Drive/${FOLDER}`)}`;
const PUSH_BOUND_MS = 8_000;

const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;
const davUrl = (path: string) => `${API}/files/users/${E2E_USERNAME}/${path}`;
const inFolder = (name: string) => `${encodeURIComponent(FOLDER)}/${encodeURIComponent(name)}`;

/** WebDAV, as a desktop client would. Retries a 429 so a write never flakes on the budget. */
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
      if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`${method} ${path} stayed rate limited`);
}

const put = (name: string) =>
  dav("PUT", inFolder(name), `push ${RUN}\n`, { "Content-Type": "text/plain" });

function countFileNodeChanges(pages: Page[]) {
  let count = 0;
  const onRequest = (request: Request) => {
    if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
    if ((request.postData() ?? "").includes("FileNode/changes")) count += 1;
  };
  for (const page of pages) page.on("request", onRequest);
  return {
    reset() {
      count = 0;
    },
    count: () => count,
  };
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}

/** The tab that sent the latest push request holds the stream. */
function trackStreamTab(pages: Page[]): () => Page | null {
  let last: Page | null = null;
  for (const page of pages) {
    page.on("request", (request) => {
      if (/\/jmap\/events\//.test(request.url())) last = page;
    });
  }
  return () => last;
}

const listed = (page: Page, name: string) => page.getByText(name, { exact: true }).first();

test("a WebDAV write reaches an open Drive folder and the Docs home on push", async ({ page }) => {
  test.setTimeout(180_000);
  const folder = encodeURIComponent(FOLDER);
  await dav("MKCOL", `${folder}/`);
  await put("a.md");
  await put("b.txt");

  const context = page.context();
  const tabA = page;
  const tabB = await context.newPage();
  const counter = countFileNodeChanges([tabA, tabB]);
  const streamTab = trackStreamTab([tabA, tabB]);

  await Promise.all([pushConnected(context), tabA.goto(FOLDER_URL)]);
  await expect(listed(tabA, "a.md")).toBeVisible({ timeout: 30_000 });
  await expect(listed(tabA, "b.txt")).toBeVisible();
  await tabB.goto("/docs");
  await expect(docsHomeRow(tabB, "a.md")).toBeVisible({ timeout: 30_000 });
  // Let the first syncs settle so they do not count as a push.
  await tabA.waitForTimeout(3_000);

  const wave = async (write: () => Promise<void>, expectation: () => Promise<unknown>) => {
    counter.reset();
    const sentAt = Date.now();
    await write();
    await expectation();
    expect(Date.now() - sentAt).toBeLessThan(PUSH_BOUND_MS + 2_000);
    // A stray second fetch would come with the next stream request (3 s retry).
    await tabA.waitForTimeout(3_000);
    expect(counter.count(), "FileNode/changes across both tabs").toBe(1);
  };
  const within = { timeout: PUSH_BOUND_MS };

  await wave(
    () => put("c.md"),
    () =>
      Promise.all([
        expect(listed(tabA, "c.md")).toBeVisible(within),
        expect(docsHomeRow(tabB, "c.md")).toBeVisible(within),
      ]),
  );
  await wave(
    () =>
      dav("MOVE", inFolder("a.md"), undefined, { Destination: davUrl(inFolder("a-renamed.md")) }),
    () =>
      Promise.all([
        expect(listed(tabA, "a-renamed.md")).toBeVisible(within),
        expect(listed(tabA, "a.md")).toHaveCount(0, within),
        expect(docsHomeRow(tabB, "a-renamed.md")).toBeVisible(within),
      ]),
  );
  await wave(
    () => dav("DELETE", inFolder("b.txt")),
    () => expect(listed(tabA, "b.txt")).toHaveCount(0, within),
  );

  // Reload the tab that holds the stream; the other tab takes it over.
  const leader = streamTab() ?? tabA;
  await Promise.all([pushConnected(context), leader.reload()]);
  await expect(leader === tabA ? listed(tabA, "c.md") : docsHomeRow(tabB, "c.md")).toBeVisible({
    timeout: 30_000,
  });
  await tabA.waitForTimeout(3_000);

  await wave(
    () =>
      dav("MOVE", inFolder("c.md"), undefined, { Destination: davUrl(inFolder("c-renamed.md")) }),
    () =>
      Promise.all([
        expect(listed(tabA, "c-renamed.md")).toBeVisible(within),
        expect(docsHomeRow(tabB, "c-renamed.md")).toBeVisible(within),
      ]),
  );
});
