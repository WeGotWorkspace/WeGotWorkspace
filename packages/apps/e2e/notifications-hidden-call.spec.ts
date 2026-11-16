import { expect, test, type Browser, type BrowserContext, type Page } from "./helpers/live-test";
import { api, OWNER, passwordFor, TEAMMATE } from "./helpers/live-matrix";
import { admitFirstKnocker } from "./helpers/meet-lobby";
import { APP, tokenFor } from "./helpers/notifications-live";

/**
 * #2129: a tab in a live Meet call keeps the push stream awake while the call
 * window is hidden. The stream reconnects at the visible pace (3 to 5 s, not
 * 30 s), and a new inbox row is local-acked within the grace, so Web Push does
 * not also buzz the user who is on the call.
 *
 * The member joins the admin's ad-hoc room and is admitted; it is the member's
 * only tab. The spec hides that tab the way a user switches away (a stubbed
 * `visibilityState` and a `visibilitychange` event). A third user then sends the
 * member a DM over REST, from outside the call mesh.
 */

const GRACE_MS = 20_000;
const SETTLE_MS = 10_000;
const WATCH_MS = 14_000;

test.use({
  storageState: { cookies: [], origins: [] },
  permissions: ["camera", "microphone"],
});
test.describe.configure({ timeout: 180_000 });

test("a hidden tab in a Meet call still hears a new DM and acks it", async ({ browser }) => {
  const run = Date.now().toString(36);
  const third = `e2e-hc-${run}`;
  const room = newAdHocRoomCode();
  const contexts: BrowserContext[] = [];

  try {
    const created = await api(OWNER, "POST", "/admin/users", {
      username: third,
      password: passwordFor(third),
      displayName: `HiddenCall ${run}`,
      email: `${third}@example.test`,
    });
    expect(created.status, JSON.stringify(created.json)).toBeLessThan(300);

    // A DM needs a shared Team.
    const team = `e2e-hct-${run}`;
    const made = await api(OWNER, "POST", "/admin/groups", { slug: team, displayName: team });
    expect(made.status, JSON.stringify(made.json)).toBeLessThan(300);
    for (const user of [third, TEAMMATE]) {
      const added = await api(OWNER, "PUT", `/admin/groups/${team}/members/${user}`);
      expect(added.status, JSON.stringify(added.json)).toBeLessThan(300);
    }

    const host = await openAs(browser, OWNER);
    const guest = await openAs(browser, TEAMMATE);
    contexts.push(host.context, guest.context);

    const channel = await api(OWNER, "POST", "/chat/channels", {
      name: `E2E hidden call ${run}`,
      kind: "meeting",
      guestRoomCode: room,
    });
    expect(channel.status, JSON.stringify(channel.json)).toBeLessThan(300);

    const events: number[] = [];
    guest.context.on("request", (request) => {
      if (/\/jmap\/events\//.test(request.url())) events.push(Date.now());
    });
    const listed: Array<{ id: string; body?: string | null }> = [];
    guest.context.on("response", (response) => {
      const url = new URL(response.url());
      if (!/\/api\/v1\/notifications$/.test(url.pathname) || !url.searchParams.has("unread")) {
        return;
      }
      void response
        .json()
        .then((payload: { list?: typeof listed }) => listed.push(...(payload.list ?? [])))
        .catch(() => undefined);
    });
    const acked: Array<{ id: string; at: number }> = [];
    guest.context.on("request", (request) => {
      if (request.method() === "POST" && /\/notifications\/local-ack$/.test(request.url())) {
        const ids = (request.postDataJSON() as { ids?: string[] } | null)?.ids ?? [];
        for (const id of ids) acked.push({ id, at: Date.now() });
      }
    });

    // The host starts the call; the member knocks and is admitted.
    await host.page.goto(`/meet/meetings/${room}`);
    const meetButton = host.page
      .locator(".meet-workspace__header-actions")
      .getByRole("button", { name: "Meet", exact: true });
    void meetButton.click({ timeout: 15_000 }).catch(() => undefined);
    await guest.page.goto(`/meet/meetings/${room}`);
    await expect(
      host.page.getByRole("heading", { name: "1 person waiting in the lobby" }),
    ).toBeVisible({ timeout: 30_000 });
    await admitFirstKnocker(host.page);
    await expect(guest.page.getByRole("button", { name: "Leave", exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // The user switches away from the call window.
    await setHidden(guest.page, true);
    await guest.page.waitForTimeout(SETTLE_MS);

    // While hidden the stream reconnects at the visible pace.
    const from = events.length;
    await guest.page.waitForTimeout(WATCH_MS);
    const watched = events.slice(Math.max(from - 1, 0));
    const gaps = watched.slice(1).map((start, index) => start - watched[index]!);
    expect(gaps.length, `reconnects while hidden: ${gaps.join(" ")}`).toBeGreaterThanOrEqual(2);
    expect(
      gaps.filter((gap) => gap < 2_800 || gap > 6_000),
      `gaps of about 3 to 5 s: ${gaps.join(" ")}`,
    ).toEqual([]);

    // A third user sends the member a DM over REST.
    const dm = await api(third, "POST", "/chat/dms", { principal: TEAMMATE });
    expect(dm.status, JSON.stringify(dm.json)).toBeLessThan(300);
    const channelId = (dm.json as { id: string }).id;
    const text = `hidden in call ${run}`;
    const sentAt = Date.now();
    const sent = await api(
      third,
      "POST",
      `/chat/channels/${encodeURIComponent(channelId)}/messages`,
      {
        id: ulid(),
        body: text,
      },
    );
    expect(sent.status, JSON.stringify(sent.json)).toBeLessThan(300);

    await expect
      .poll(() => listed.find((row) => row.body?.includes(text))?.id, { timeout: GRACE_MS })
      .toBeTruthy();
    const rowId = listed.find((row) => row.body?.includes(text))!.id;
    await expect
      .poll(() => acked.find((entry) => entry.id === rowId)?.at, { timeout: GRACE_MS })
      .toBeTruthy();
    expect(acked.find((entry) => entry.id === rowId)!.at - sentAt).toBeLessThanOrEqual(GRACE_MS);
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
  }
});

/** The user switches away from `page` (or back to it). */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await page.waitForTimeout(300);
}

function newAdHocRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

async function openAs(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const accessToken = await tokenFor(username);
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
  });
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: accessToken },
  );
  return { context, page: await context.newPage() };
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
