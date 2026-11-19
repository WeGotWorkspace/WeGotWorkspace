import { expect, test, type Page, type Request } from "./helpers/live-test";
import {
  dmChannel,
  postDm,
  pushConnected,
  signedInContext,
  tokenFor,
} from "./helpers/notifications-live";

/**
 * #2252: with push connected, only the tab that holds the push stream runs the
 * 60 s inbox backup poll; the other tab sends no inbox GET and still shows the
 * same rows in its bell. With push down, both tabs poll every 15 s again.
 */

const PUSH_POLL_MS = 60_000;
const POLL_MS = 15_000;

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

test("with push up one tab polls the inbox; with push down both do", async ({ browser }) => {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await signedInContext(browser, adminToken);

  try {
    const channelId = await dmChannel(context, memberToken, "admin");
    const text = `inbox poll ${Date.now()}`;
    await postDm(context, memberToken, channelId, text);

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    const gets = new Map<Page, number>([
      [tabA, 0],
      [tabB, 0],
    ]);
    const isInboxGet = (request: Request) =>
      request.method() === "GET" &&
      /\/api\/v1\/notifications$/.test(new URL(request.url()).pathname) &&
      new URL(request.url()).searchParams.has("unread");
    for (const page of [tabA, tabB]) {
      page.on("request", (request) => {
        if (isInboxGet(request)) gets.set(page, (gets.get(page) ?? 0) + 1);
      });
    }
    let streamTab: Page | null = null;
    for (const page of [tabA, tabB]) {
      page.on("request", (request) => {
        if (/\/jmap\/events\//.test(request.url())) streamTab = page;
      });
    }

    await Promise.all([pushConnected(context), tabA.goto("/notes")]);
    await tabB.goto("/notes");
    for (const page of [tabA, tabB]) {
      await page.locator(".notification-inbox-tray__trigger").click();
      await expect(
        page.locator(".notification-inbox-tray__popover").getByText(text, { exact: false }),
      ).toBeVisible();
    }
    const leader = streamTab as Page | null;
    if (!leader) throw new Error("No tab sent a push request.");
    const follower = leader === tabA ? tabB : tabA;

    // Let each tab's first load finish, then count over one push poll interval.
    await leader.waitForTimeout(3_000);
    gets.set(tabA, 0);
    gets.set(tabB, 0);
    await leader.waitForTimeout(PUSH_POLL_MS + 5_000);
    expect(gets.get(leader), "inbox GETs of the stream tab").toBeGreaterThanOrEqual(1);
    expect(gets.get(follower), "inbox GETs of the other tab").toBe(0);

    // Push down: new stream requests fail, so every tab polls on the short interval.
    await context.route(/\/jmap\/events\//, (route) => route.abort());
    await Promise.all([tabA.reload(), tabB.reload()]);
    await leader.waitForTimeout(3_000);
    gets.set(tabA, 0);
    gets.set(tabB, 0);
    await expect
      .poll(() => gets.get(tabA), { timeout: POLL_MS + 10_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => gets.get(tabB), { timeout: POLL_MS + 10_000 })
      .toBeGreaterThanOrEqual(1);
  } finally {
    await context.close();
  }
});
