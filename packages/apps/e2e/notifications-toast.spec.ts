import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import {
  API,
  dmChannel,
  postDm,
  pushConnected,
  signedInContext,
  tokenFor,
} from "./helpers/notifications-live";

/**
 * #1669: a new inbox row shows one in-app toast, in the tab the user focused
 * last, and none in the other tab. No toast for the DM the tab already shows,
 * and none at all while every tab is hidden. Clicking the toast opens the DM
 * and marks the row read.
 *
 * Headless Chromium keeps every page visible and focused, so the spec plays
 * the user's part through the page's own events: a window `focus` event is the
 * user clicking into a tab, and a `visibilitychange` to hidden is the user
 * switching away from it. The app reacts to both exactly as to the real ones.
 */

const TOAST_BOUND_MS = 8_000;
/** How long a tab that should stay quiet is watched after the other tab toasted. */
const QUIET_MS = 3_000;

test.use({ storageState: { cookies: [], origins: [] } });

type Setup = {
  context: BrowserContext;
  adminToken: string;
  memberToken: string;
  channelId: string;
  /** Inbox rows any tab listed, by body text. */
  listed: () => Array<{ id: string; body?: string | null }>;
  acked: () => string[];
};

async function member(browser: Parameters<typeof signedInContext>[0]): Promise<Setup> {
  const adminToken = await tokenFor("admin");
  const memberToken = await tokenFor("member");
  const context = await signedInContext(browser, memberToken);
  const channelId = await dmChannel(context, adminToken, "member");
  // A toast fades after 8 s, so a check for "no toast" must look at every toast
  // the tab ever showed, not only the ones still on screen.
  await context.addInitScript(() => {
    const seen: string[] = [];
    const counted = new WeakSet<Element>();
    (window as unknown as { __wgwToasts: string[] }).__wgwToasts = seen;
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll(".notification-toast")) {
        if (counted.has(toast)) continue;
        counted.add(toast);
        seen.push(toast.textContent ?? "");
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const listed: Array<{ id: string; body?: string | null }> = [];
  const acked: string[] = [];
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (!/\/api\/v1\/notifications$/.test(url.pathname) || !url.searchParams.has("unread")) return;
    void response
      .json()
      .then((payload: { list?: typeof listed }) => listed.push(...(payload.list ?? [])))
      .catch(() => undefined);
  });
  context.on("request", (request) => {
    if (request.method() === "POST" && /\/notifications\/local-ack$/.test(request.url())) {
      acked.push(...((request.postDataJSON() as { ids?: string[] } | null)?.ids ?? []));
    }
  });
  return {
    context,
    adminToken,
    memberToken,
    channelId,
    listed: () => listed,
    acked: () => acked,
  };
}

/** Two signed-in tabs on `routes`, push connected and the bell loaded in both. */
async function openTabs(setup: Setup, routes: [string, string]): Promise<[Page, Page]> {
  const tabA = await setup.context.newPage();
  const tabB = await setup.context.newPage();
  await Promise.all([pushConnected(setup.context), tabA.goto(routes[0])]);
  await tabB.goto(routes[1]);
  await Promise.all([
    expect(tabA.locator(".notification-inbox-tray__trigger")).toBeVisible(),
    expect(tabB.locator(".notification-inbox-tray__trigger")).toBeVisible(),
  ]);
  return [tabA, tabB];
}

/** The user clicks into `page`: it becomes the most recently focused tab. */
async function focusTab(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  // Let the tab's report reach the other tabs.
  await page.waitForTimeout(300);
}

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

const toastFor = (page: Page, text: string) =>
  page.locator("[data-sonner-toast] .notification-toast").filter({ hasText: text });

/** The text of every toast `page` showed since it loaded, also those that faded. */
const seenToasts = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __wgwToasts: string[] }).__wgwToasts]);

async function rowListed(setup: Setup, text: string): Promise<string> {
  await expect
    .poll(() => setup.listed().find((row) => row.body?.includes(text))?.id, {
      timeout: TOAST_BOUND_MS,
    })
    .toBeTruthy();
  return setup.listed().find((row) => row.body?.includes(text))!.id;
}

test("a new DM shows one toast, in the tab focused last", async ({ browser }) => {
  const setup = await member(browser);
  try {
    const [tabA, tabB] = await openTabs(setup, ["/notes", "/drive"]);

    await focusTab(tabA);
    const first = `toast A ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, first);
    const toast = toastFor(tabA, first);
    await expect(toast).toBeVisible({ timeout: TOAST_BOUND_MS });
    await expect(toast).toHaveAttribute("role", "status");
    await expect(toast).toContainText("Admin sent you a direct message");
    await expect(toast).toContainText("Meet");
    // It never takes focus.
    expect(await toast.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    await tabB.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabA)).toEqual([expect.stringContaining(first)]);
    expect(await seenToasts(tabB)).toEqual([]);

    // The user moves to the other tab; the next DM toasts there.
    await focusTab(tabB);
    const second = `toast B ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, second);
    await expect(toastFor(tabB, second)).toBeVisible({ timeout: TOAST_BOUND_MS });
    await tabA.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabB)).toEqual([expect.stringContaining(second)]);
    expect(await seenToasts(tabA)).toEqual([expect.stringContaining(first)]);
  } finally {
    await setup.context.close();
  }
});

test("no toast for the DM the focused tab already shows; the row still reaches the inbox", async ({
  browser,
}) => {
  const setup = await member(browser);
  try {
    const [tabA, tabB] = await openTabs(setup, ["/notes", "/meet/dms/admin"]);
    await focusTab(tabB);

    const text = `looking at it ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, text);
    await rowListed(setup, text);
    // The open DM shows the message itself.
    await expect(tabB.getByText(text).first()).toBeVisible({ timeout: TOAST_BOUND_MS });
    await tabB.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabA)).toEqual([]);
    expect(await seenToasts(tabB)).toEqual([]);
  } finally {
    await setup.context.close();
  }
});

test("clicking the toast opens the DM and marks the row read", async ({ browser }) => {
  const setup = await member(browser);
  try {
    const [tabA] = await openTabs(setup, ["/notes", "/drive"]);
    await focusTab(tabA);

    const text = `click me ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, text);
    const rowId = await rowListed(setup, text);
    const toast = toastFor(tabA, text);
    await expect(toast).toBeVisible({ timeout: TOAST_BOUND_MS });

    const read = tabA.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/notifications/${encodeURIComponent(rowId)}/ack`),
    );
    await toast.getByRole("button").click();
    await read;
    await expect(tabA).toHaveURL(/\/meet\/dms\/admin$/);
    await expect(tabA.getByText(text).first()).toBeVisible();

    const unread = await setup.context.request.get(`${API}/api/v1/notifications?unread=1`, {
      headers: { Authorization: `Bearer ${setup.memberToken}` },
    });
    const list = ((await unread.json()) as { list: Array<{ id: string }> }).list;
    expect(list.map((row) => row.id)).not.toContain(rowId);
  } finally {
    await setup.context.close();
  }
});

test("no toast while every tab is hidden, and none for that row later", async ({ browser }) => {
  const setup = await member(browser);
  try {
    const [tabA, tabB] = await openTabs(setup, ["/notes", "/drive"]);
    await focusTab(tabA);
    await setHidden(tabA, true);
    await setHidden(tabB, true);

    const text = `nobody looking ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, text);
    const rowId = await rowListed(setup, text);
    await tabA.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabA)).toEqual([]);
    expect(await seenToasts(tabB)).toEqual([]);
    // Nothing acked while hidden, so Web Push stays the OS notification path.
    expect(setup.acked()).not.toContain(rowId);

    // The user comes back: the row is in the bell, but it does not toast now.
    await setHidden(tabA, false);
    await focusTab(tabA);
    await tabA.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabA)).toEqual([]);
    await tabA.locator(".notification-inbox-tray__trigger").click();
    await expect(
      tabA.locator(".notification-inbox-tray__popover").getByText(text, { exact: false }),
    ).toBeVisible();
  } finally {
    await setup.context.close();
  }
});

test("a DM that arrived while every tab was hidden does not toast when it loads on return", async ({
  browser,
}) => {
  const setup = await member(browser);
  try {
    const [tabA, tabB] = await openTabs(setup, ["/notes", "/drive"]);
    await focusTab(tabA);
    await setHidden(tabB, true);
    await setHidden(tabA, true);
    // A throttled or frozen background tab: no inbox fetch reaches the server while away.
    let away = true;
    await setup.context.route(/\/api\/v1\/notifications\?/, (route) =>
      away ? route.abort() : route.continue(),
    );

    const text = `while away ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, text);
    await tabA.waitForTimeout(QUIET_MS);
    expect(setup.listed().some((row) => row.body?.includes(text))).toBe(false);

    // The user comes back: the visibility refresh brings the row, it does not toast.
    away = false;
    await setHidden(tabA, false);
    await focusTab(tabA);
    await rowListed(setup, text);
    await tabA.waitForTimeout(QUIET_MS);
    expect(await seenToasts(tabA)).toEqual([]);
    expect(await seenToasts(tabB)).toEqual([]);

    // News that arrives now that the user is back still toasts.
    const next = `back again ${Date.now()}`;
    await postDm(setup.context, setup.adminToken, setup.channelId, next);
    await expect(toastFor(tabA, next)).toBeVisible({ timeout: TOAST_BOUND_MS });
  } finally {
    await setup.context.close();
  }
});
