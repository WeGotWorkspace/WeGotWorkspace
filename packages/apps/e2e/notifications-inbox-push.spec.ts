import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";

/**
 * #1668: a new notification reaches the bell on push, in two tabs of one
 * browser, with one inbox GET and one local-ack for the whole browser. Then
 * the tab that held the stream reloads, and the same holds again.
 *
 * Bound: 8 s, well inside the 15 s poll. While push is connected the fallback
 * poll runs every 60 s, and the whole spec runs well within 60 s of push
 * connecting, so a pass proves the push path. The member writes over REST, so
 * no mesh `notify-hint` reaches the admin's tabs either.
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const PUSH_BOUND_MS = 8_000;

test.use({ storageState: { cookies: [], origins: [] } });

test("a new notification reaches the bell of both tabs on push, fetched and acked once", async ({
  browser,
}) => {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: adminToken },
  );

  try {
    const dm = await context.request.post(`${API}/api/v1/chat/dms`, {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { principal: "admin" },
    });
    expect(dm.ok(), await dm.text()).toBeTruthy();
    const channelId = ((await dm.json()) as { id: string }).id;

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const counter = countInboxRequests([tabA, tabB]);
    const streamTab = trackStreamTab([tabA, tabB]);
    await Promise.all([pushConnected(context), tabA.goto("/notes")]);
    await tabB.goto("/notes");
    await Promise.all([openBell(tabA), openBell(tabB)]);

    const first = await notifyAdmin(context, memberToken, channelId, counter, [tabA, tabB]);
    test.info().annotations.push({ type: "latency", description: `first: ${first} ms` });
    expect(first).toBeLessThan(PUSH_BOUND_MS);

    // Reload the tab that holds the stream; the other tab takes it over.
    const leader = streamTab();
    if (!leader) throw new Error("No tab sent a push request.");
    await Promise.all([pushConnected(context), leader.reload()]);
    await openBell(leader);

    const second = await notifyAdmin(context, memberToken, channelId, counter, [tabA, tabB]);
    test.info().annotations.push({ type: "latency", description: `after reload: ${second} ms` });
    expect(second).toBeLessThan(PUSH_BOUND_MS);
    console.log(`[inbox-push] DM sent → row in both bells: ${first} ms, after reload ${second} ms`);
  } finally {
    await context.close();
  }
});

/**
 * The member sends the admin a DM. Waits until both bells show the row, then
 * checks one inbox GET and one local-ack for it across the tabs. Returns the
 * time from sending to the row showing in both tabs.
 */
async function notifyAdmin(
  context: BrowserContext,
  memberToken: string,
  channelId: string,
  counter: ReturnType<typeof countInboxRequests>,
  tabs: Page[],
): Promise<number> {
  const text = `inbox push ${Date.now()}`;
  counter.reset();
  const sentAt = Date.now();
  const posted = await context.request.post(
    `${API}/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`,
    {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { id: ulid(), body: text },
    },
  );
  expect(posted.ok(), await posted.text()).toBeTruthy();
  await Promise.all(
    tabs.map((tab) =>
      expect(
        tab.locator(".notification-inbox-tray__popover").getByText(text, { exact: false }),
      ).toBeVisible({ timeout: PUSH_BOUND_MS }),
    ),
  );
  const latency = Date.now() - sentAt;
  // The ack follows the row in the tab that claimed it; give it a moment.
  await expect.poll(() => counter.acks().length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  await tabs[0]!.waitForTimeout(1_000);
  expect(counter.gets(), "inbox GETs across both tabs").toHaveLength(1);
  expect(counter.acks(), "local-acks across both tabs").toHaveLength(1);
  return latency;
}

function countInboxRequests(pages: Page[]) {
  let gets: string[] = [];
  let acks: string[] = [];
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && /\/api\/v1\/notifications$/.test(url.pathname)) {
      if (url.searchParams.has("unread")) gets.push(url.href);
    }
    if (request.method() === "POST" && /\/notifications\/[^/]+\/local-ack$/.test(url.pathname)) {
      acks.push(url.pathname);
    }
  };
  for (const page of pages) page.on("request", onRequest);
  return {
    reset() {
      gets = [];
      acks = [];
    },
    gets: () => gets,
    acks: () => acks,
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

async function openBell(page: Page): Promise<void> {
  await page.locator(".notification-inbox-tray__trigger").click();
  await expect(page.locator(".notification-inbox-tray__popover")).toBeVisible();
}

async function tokenFor(username: string): Promise<string> {
  const response = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  expect(response.ok, await response.clone().text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error(`Login for ${username} did not return tokens.`);
  return tokens.access_token;
}

/** Chat message ids are ULIDs (26 Crockford base32 characters). */
function ulid(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  let tail = "";
  for (let i = 0; i < 16; i++) tail += alphabet[Math.floor(Math.random() * 32)];
  return head + tail;
}
