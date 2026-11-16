import { expect, test, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #1641 step d: a DM log of more than 80 rows mounts only a window of messages.
 * Real-time messages must still land at the bottom, show "New messages" when the
 * reader is scrolled up, and a reload must open at the newest message.
 */

const SEEDED = 120;
const STICK_PX = 48;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a windowed DM receives messages in real time and opens at the newest", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const run = `win${Date.now().toString(36)}`;
  const first = `${run} seed 1`;
  const last = `${run} seed ${SEEDED}`;
  const channelId = await openDm();
  for (let n = 1; n <= SEEDED; n += 1) await post(channelId, `${run} seed ${n}`);

  const context = await openUser(browser, TEAMMATE);
  try {
    const tab = await context.newPage();
    await tab.goto(`/meet/dms/${OWNER}`);
    const log = tab.getByRole("log").first();
    await expect(message(tab, last)).toBeVisible({ timeout: 30_000 });
    await expect(message(tab, first)).toHaveCount(0);
    await expect.poll(() => distanceFromBottom(tab)).toBeLessThan(STICK_PX);

    const live = `${run} live while at bottom`;
    await post(channelId, live);
    await expect(message(tab, live)).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => distanceFromBottom(tab)).toBeLessThan(STICK_PX);

    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(message(tab, first)).toHaveCount(1, { timeout: 10_000 });
    const before = await log.evaluate((el) => el.scrollTop);

    const away = `${run} live while scrolled up`;
    await post(channelId, away);
    const jump = tab.getByRole("button", { name: "New messages" });
    await expect(jump).toBeVisible({ timeout: 15_000 });
    expect(Math.abs((await log.evaluate((el) => el.scrollTop)) - before)).toBeLessThan(STICK_PX);

    await jump.click();
    await expect(message(tab, away)).toBeVisible();
    await expect.poll(() => distanceFromBottom(tab)).toBeLessThan(STICK_PX);

    await tab.reload();
    await expect(message(tab, away)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => distanceFromBottom(tab)).toBeLessThan(STICK_PX);
  } finally {
    await context.close();
  }
});

function message(tab: Page, body: string) {
  return tab.getByRole("log").first().getByText(body, { exact: true });
}

function distanceFromBottom(tab: Page): Promise<number> {
  return tab
    .getByRole("log")
    .first()
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

async function openDm(): Promise<string> {
  const res = await api(OWNER, "POST", "/chat/dms", { principal: TEAMMATE });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Open DM ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return (res.json as { id: string }).id;
}

async function post(channelId: string, body: string): Promise<void> {
  const res = await api(OWNER, "POST", `/chat/channels/${encodeURIComponent(channelId)}/messages`, {
    id: ulid(),
    body,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Post ${res.status}: ${JSON.stringify(res.json)}`);
  }
}

/** A client message id: 26 characters of Crockford base32, time first. */
function ulid(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i += 1) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  let tail = "";
  for (let i = 0; i < 16; i += 1) tail += alphabet[Math.floor(Math.random() * 32)];
  return head + tail;
}
