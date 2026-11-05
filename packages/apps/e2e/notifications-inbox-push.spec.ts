import { expect, test, type BrowserContext, type Page, type Request } from "./helpers/live-test";
import {
  dmChannel,
  postDm,
  pushConnected,
  signedInContext,
  tokenFor,
} from "./helpers/notifications-live";

/**
 * #1668: a new notification reaches the bell on push, in two tabs of one
 * browser, with one inbox GET and one local-ack for the whole browser. Then
 * the tab that held the stream reloads, and the same holds again.
 *
 * #1834: when the tab that held the stream closes, the other tab takes it
 * over and acks only the new row, not the unread rows the first tab acked.
 *
 * Bound: 8 s, well inside the 15 s poll. While push is connected the fallback
 * poll runs every 60 s, and the whole spec runs well within 60 s of push
 * connecting, so a pass proves the push path. The sender writes over REST, so
 * no mesh `notify-hint` reaches the recipient's tabs either.
 */

const PUSH_BOUND_MS = 8_000;

test.use({ storageState: { cookies: [], origins: [] } });

test("a new notification reaches the bell of both tabs on push, fetched and acked once", async ({
  browser,
}) => {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await signedInContext(browser, adminToken);

  try {
    const channelId = await dmChannel(context, memberToken, "admin");

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const counter = countInboxRequests([tabA, tabB]);
    const streamTab = trackStreamTab([tabA, tabB]);
    await Promise.all([pushConnected(context), tabA.goto("/notes")]);
    await tabB.goto("/notes");
    await Promise.all([openBell(tabA), openBell(tabB)]);

    const first = await sendDm(context, memberToken, channelId, counter, [tabA, tabB]);
    test.info().annotations.push({ type: "latency", description: `first: ${first.latency} ms` });
    expect(first.latency).toBeLessThan(PUSH_BOUND_MS);

    // Reload the tab that holds the stream; the other tab takes it over.
    const leader = streamTab();
    if (!leader) throw new Error("No tab sent a push request.");
    counter.reset();
    await Promise.all([pushConnected(context), leader.reload()]);
    await openBell(leader);
    // The reloaded inbox load lists the first row as unread, yet it is not acked again.
    await expect(
      leader.locator(".notification-inbox-tray__popover").getByText(first.text, { exact: false }),
    ).toBeVisible({ timeout: PUSH_BOUND_MS });
    await leader.waitForTimeout(3_000);
    expect(counter.acks(), "local-acks after reload").toHaveLength(0);

    const second = (await sendDm(context, memberToken, channelId, counter, [tabA, tabB])).latency;
    test.info().annotations.push({ type: "latency", description: `after reload: ${second} ms` });
    expect(second).toBeLessThan(PUSH_BOUND_MS);
    console.log(
      `[inbox-push] DM sent → row in both bells: ${first.latency} ms, after reload ${second} ms`,
    );
  } finally {
    await context.close();
  }
});

test("a tab that takes over the stream acks only the new row, not the rows the closed tab acked", async ({
  browser,
}) => {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await signedInContext(browser, memberToken);

  try {
    const channelId = await dmChannel(context, adminToken, "member");
    // Unread rows the member already has before any tab opens.
    for (let i = 0; i < 3; i++)
      await postDm(context, adminToken, channelId, `unread ${i} ${Date.now()}`);

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const counter = countInboxRequests([tabA, tabB]);
    const streamTab = trackStreamTab([tabA, tabB]);
    await Promise.all([pushConnected(context), tabA.goto("/notes")]);
    await tabB.goto("/notes");
    await Promise.all([openBell(tabA), openBell(tabB)]);
    // The first load acks every unread row in one request.
    await expect.poll(() => counter.acks().length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const ackedOnLoad = counter.acks().flat();
    expect(ackedOnLoad.length, "unread rows acked on load").toBeGreaterThanOrEqual(3);

    const first = await sendDm(context, adminToken, channelId, counter, [tabA, tabB]);
    const acked = new Set([...ackedOnLoad, ...first.ackedIds]);

    // Close the tab that holds the stream; the other tab takes it over.
    const leader = streamTab();
    if (!leader) throw new Error("No tab sent a push request.");
    const survivor = leader === tabA ? tabB : tabA;
    counter.reset();
    await Promise.all([pushConnected(context), leader.close()]);
    await survivor.waitForTimeout(3_000);
    expect(counter.acks(), "local-acks when the stream moves").toHaveLength(0);

    const second = await sendDm(context, adminToken, channelId, counter, [survivor]);
    expect(second.ackedIds, "ids the new stream tab acked").toEqual([second.rowId]);
    expect(acked.has(second.rowId)).toBe(false);
    console.log(
      `[inbox-push] takeover: ${acked.size} rows acked before, then 1 local-ack with ${second.ackedIds.length} id`,
    );
  } finally {
    await context.close();
  }
});

/**
 * `senderToken` posts a DM. Waits until every bell in `tabs` shows the row,
 * then checks one inbox GET and one local-ack for it across the tabs. Returns
 * the time from sending to the row showing everywhere, the row's id, and the
 * ids that local-ack sent.
 */
async function sendDm(
  context: BrowserContext,
  senderToken: string,
  channelId: string,
  counter: ReturnType<typeof countInboxRequests>,
  tabs: Page[],
): Promise<{ latency: number; text: string; rowId: string; ackedIds: string[] }> {
  const text = `inbox push ${Date.now()}`;
  counter.reset();
  const sentAt = Date.now();
  await postDm(context, senderToken, channelId, text);
  await Promise.all(
    tabs.map((tab) =>
      expect(
        tab.locator(".notification-inbox-tray__popover").getByText(text, { exact: false }),
      ).toBeVisible({ timeout: PUSH_BOUND_MS }),
    ),
  );
  const latency = Date.now() - sentAt;
  // The ack follows the row in whichever tab flushes first; give it a moment.
  await expect.poll(() => counter.acks().length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  // A stray second fetch would come with the next stream request (3 s retry).
  await tabs[0]!.waitForTimeout(3_000);
  expect(counter.gets(), "inbox GETs across the tabs").toHaveLength(1);
  expect(counter.acks(), "local-acks across the tabs").toHaveLength(1);
  const row = counter.listed().find((item) => item.body?.includes(text));
  if (!row) throw new Error(`No inbox GET listed the row for "${text}".`);
  return { latency, text, rowId: row.id, ackedIds: counter.acks()[0]! };
}

type ListedRow = { id: string; body?: string | null };

/** Inbox GETs, the ids each local-ack sent, and the rows the GETs listed. */
function countInboxRequests(pages: Page[]) {
  let gets: string[] = [];
  let acks: string[][] = [];
  let listed: ListedRow[] = [];
  const isInboxGet = (request: Request) =>
    request.method() === "GET" &&
    /\/api\/v1\/notifications$/.test(new URL(request.url()).pathname) &&
    new URL(request.url()).searchParams.has("unread");
  for (const page of pages) {
    page.on("request", (request) => {
      if (isInboxGet(request)) gets.push(request.url());
      if (request.method() === "POST" && /\/notifications\/local-ack$/.test(request.url())) {
        const body = request.postDataJSON() as { ids?: string[] } | null;
        acks.push(body?.ids ?? []);
      }
    });
    page.on("response", (response) => {
      if (!isInboxGet(response.request()) || !response.ok()) return;
      void response
        .json()
        .then((payload: { list?: ListedRow[] }) => listed.push(...(payload.list ?? [])))
        .catch(() => undefined);
    });
  }
  return {
    reset() {
      gets = [];
      acks = [];
      listed = [];
    },
    gets: () => gets,
    acks: () => acks,
    listed: () => listed,
  };
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

async function openBell(page: Page): Promise<void> {
  await page.locator(".notification-inbox-tray__trigger").click();
  await expect(page.locator(".notification-inbox-tray__popover")).toBeVisible();
}
