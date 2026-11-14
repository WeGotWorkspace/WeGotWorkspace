import { expect, test, type APIRequestContext, type Page } from "./helpers/live-test";
import {
  API,
  dmChannel,
  postDm,
  pushConnected,
  signedInContext,
  tokenFor,
} from "./helpers/notifications-live";

/**
 * #2154: opening a Meet DM with several unread mentions marks them all read
 * with one request, the user's other tab hears about it through push (no
 * reload), and a reload does not bring the rows back.
 */

const SEEDED = 5;
const ACK_URL = /\/api\/v1\/notifications\/(ack|[^/]+\/ack)$/;

test.use({ storageState: { cookies: [], origins: [] } });

type Row = { id: string; body?: string | null };

async function unreadRows(request: APIRequestContext, token: string): Promise<Row[]> {
  const response = await request.get(`${API}/api/v1/notifications?unread=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { list: Row[] }).list;
}

/** Earlier specs leave unread rows on the shared account; start from none. */
async function readEverything(request: APIRequestContext, token: string): Promise<void> {
  for (let rows = await unreadRows(request, token); rows.length > 0;) {
    const done = await request.post(`${API}/api/v1/notifications/ack`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ids: rows.slice(0, 100).map((row) => row.id) },
    });
    expect(done.ok(), await done.text()).toBeTruthy();
    rows = await unreadRows(request, token);
  }
}

const bell = (page: Page) => page.locator(".notification-inbox-tray__trigger");

test("opening a DM with unread mentions marks them read in one request, in every tab", async ({
  browser,
}) => {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await signedInContext(browser, memberToken);
  try {
    const channelId = await dmChannel(context, adminToken, "member");
    await readEverything(context.request, memberToken);

    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await Promise.all([pushConnected(context), tabA.goto("/notes")]);
    await tabB.goto("/drive");
    await expect(bell(tabA)).toBeVisible();
    await expect(bell(tabB)).toBeVisible();

    const stamp = Date.now();
    const texts = Array.from({ length: SEEDED }, (_, i) => `read batch ${stamp} #${i + 1}`);
    for (const text of texts) await postDm(context, adminToken, channelId, text);
    await expect
      .poll(async () => (await unreadRows(context.request, memberToken)).length)
      .toBe(SEEDED);
    const seededIds = (await unreadRows(context.request, memberToken)).map((row) => row.id);
    // Both tabs know about them before the user opens the DM.
    await expect(bell(tabA)).toHaveAttribute("data-count", String(SEEDED));
    await expect(bell(tabB)).toHaveAttribute("data-count", String(SEEDED));

    const acks: Array<{ url: string; ids: string[] }> = [];
    tabA.on("request", (request) => {
      if (request.method() !== "POST" || !ACK_URL.test(request.url())) return;
      const body = request.postDataJSON() as { ids?: string[] } | null;
      acks.push({ url: request.url(), ids: body?.ids ?? [] });
    });

    await tabA.goto("/meet/dms/admin");
    await expect(tabA.getByText(texts[SEEDED - 1]).first()).toBeVisible();
    await expect(bell(tabA)).not.toHaveAttribute("data-count");

    expect(acks).toHaveLength(1);
    expect(acks[0].url).toMatch(/\/api\/v1\/notifications\/ack$/);
    expect([...acks[0].ids].sort()).toEqual([...seededIds].sort());

    // The other tab clears without a reload: the server moved the inbox state once.
    await expect(bell(tabB)).not.toHaveAttribute("data-count");

    await tabA.reload();
    await expect(bell(tabA)).toBeVisible();
    await expect(bell(tabA)).not.toHaveAttribute("data-count");
    expect(await unreadRows(context.request, memberToken)).toEqual([]);
    expect(acks).toHaveLength(1);
  } finally {
    await context.close();
  }
});
