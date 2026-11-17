import { expect, test, type Locator, type Page } from "./helpers/live-test";
import { api, chatMessageId, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #1641 step d, chunk F: a chat log longer than the list window (80 rows)
 * mounts only the rows near the screen and follows the newest message. The
 * teammate has a channel of 120 messages open while the owner posts over the
 * API: at the bottom the log stays at the newest; scrolled up it keeps its
 * place and offers "New messages"; a reload opens at the newest again.
 */

const SEEDED = 120;
/** The log counts as "at the newest" this close to its end (the list's own threshold). */
const AT_NEWEST_PX = 48;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a chat log of 120 messages follows the newest message and keeps its place when scrolled up", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const run = `window${Date.now().toString(36)}`;
  const channelId = await sharedChannel(run);
  const context = await openUser(browser, TEAMMATE);

  try {
    for (let n = 1; n <= SEEDED; n += 1) await post(channelId, seeded(run, n));

    // Opens at the newest message, with the oldest not mounted.
    const tab = await context.newPage();
    await tab.goto(`/meet/channels/${encodeURIComponent(channelId)}`);
    const log = chatLog(tab);
    await expect(message(log, seeded(run, SEEDED))).toBeInViewport({ timeout: 60_000 });
    await expect(message(log, seeded(run, 1))).toHaveCount(0);
    await expect.poll(() => distanceFromNewest(log)).toBeLessThan(AT_NEWEST_PX);

    // A message that arrives while at the newest lands in view.
    const atBottom = `${run} arrives at the bottom`;
    await post(channelId, atBottom);
    await expect(message(log, atBottom)).toBeInViewport({ timeout: 30_000 });
    await expect.poll(() => distanceFromNewest(log)).toBeLessThan(AT_NEWEST_PX);

    // Scrolled to the top, the oldest message is mounted.
    const oldest = message(log, seeded(run, 1));
    await expect
      .poll(async () => {
        await log.evaluate((element) => {
          element.scrollTop = 0;
        });
        return oldest.isVisible();
      })
      .toBe(true);
    await expect(oldest).toBeInViewport();

    // A message that arrives while scrolled up offers "New messages" and keeps the view.
    const before = await oldest.boundingBox();
    const whileUp = `${run} arrives while scrolled up`;
    await post(channelId, whileUp);
    const jump = tab.getByRole("button", { name: "New messages" });
    await expect(jump).toBeVisible({ timeout: 30_000 });
    const after = await oldest.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);

    await jump.click();
    await expect(message(log, whileUp)).toBeInViewport();
    await expect.poll(() => distanceFromNewest(log)).toBeLessThan(AT_NEWEST_PX);

    // A reload opens at the newest message again.
    await tab.reload();
    await expect(message(chatLog(tab), whileUp)).toBeInViewport({ timeout: 60_000 });
    await expect.poll(() => distanceFromNewest(chatLog(tab))).toBeLessThan(AT_NEWEST_PX);
  } finally {
    await context.close();
    await api(OWNER, "DELETE", `/chat/channels/${encodeURIComponent(channelId)}`).catch(
      () => undefined,
    );
  }
});

function seeded(run: string, n: number): string {
  return `${run} message ${String(n).padStart(3, "0")}`;
}

/** The channel's message log on screen (Meet also keeps a log for its side rail). */
function chatLog(tab: Page): Locator {
  return tab.locator('[role="log"]:visible').first();
}

function message(log: Locator, body: string): Locator {
  return log.getByText(body, { exact: true });
}

function distanceFromNewest(log: Locator): Promise<number> {
  return log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
}

/** A channel of the owner's that the teammate may read. */
async function sharedChannel(name: string): Promise<string> {
  const created = await api(OWNER, "POST", "/chat/channels", { name, kind: "channel" });
  if (created.status !== 201) throw new Error(`Create channel ${created.status}`);
  const { id } = created.json as { id: string };
  const shared = await api(OWNER, "PATCH", `/chat/channels/${encodeURIComponent(id)}`, {
    shareWith: {
      [TEAMMATE]: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
    },
  });
  if (shared.status >= 300) throw new Error(`Share channel ${shared.status}`);
  return id;
}

async function post(channelId: string, body: string): Promise<void> {
  const res = await api(OWNER, "POST", `/chat/channels/${encodeURIComponent(channelId)}/messages`, {
    id: chatMessageId(),
    body,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Post ${res.status}: ${JSON.stringify(res.json)}`);
  }
}
