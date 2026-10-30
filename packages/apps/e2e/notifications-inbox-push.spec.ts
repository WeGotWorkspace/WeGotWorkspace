// Inbox on push, across tabs (#1668), live app and API.
//
// Two tabs of `admin` share one browser context. The tab that holds the JMAP
// push stream fetches the inbox once and fans the rows out; the other tab shows
// them. `member` sends a direct message, which notifies `admin`. The bell must
// show it well inside the 15 s poll (the fallback poll is 60 s while push is
// connected, so a pass proves the push path), with one inbox GET and one
// local-ack POST across both tabs.
import { expect, test, type Page, type Request } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const VISIBLE_WITHIN_MS = 8_000;

test.describe("Notification inbox on push (live app)", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a notification reaches the bell of both tabs by push, with one fetch and one ack", async ({
    page: tabA,
    browser,
    context,
  }) => {
    const inboxGets: string[] = [];
    const localAcks: string[] = [];
    const count = (request: Request) => {
      const url = request.url();
      if (request.method() === "GET" && /\/api\/v1\/notifications\?.*unread/.test(url)) {
        inboxGets.push(url);
      }
      if (request.method() === "POST" && /\/api\/v1\/notifications\/[^/]+\/local-ack/.test(url)) {
        localAcks.push(url);
      }
    };

    // Tab A opens first, so it holds the push stream.
    await openApp(tabA, () => tabA.goto("/notes"));
    const tabB = await context.newPage();
    await openApp(tabB, () => tabB.goto("/notes"), { holdsStream: false });
    for (const tab of [tabA, tabB]) tab.on("request", count);

    const member = await memberClient(browser);
    try {
      const channelId = await openDmWithAdmin(member);
      await expectSettledBell(tabA);

      for (const round of ["first", "after the stream tab reloads"]) {
        if (round !== "first") {
          await openApp(tabA, () => tabA.reload());
          await expectSettledBell(tabA);
        }
        inboxGets.length = 0;
        localAcks.length = 0;
        const before = await unreadCount(tabB);

        const sentAt = Date.now();
        await member.send(channelId, `inbox push ${round} ${sentAt}`);
        await expect
          .poll(() => unreadCount(tabA), { timeout: VISIBLE_WITHIN_MS })
          .toBeGreaterThan(before);
        const visibleA = Date.now() - sentAt;
        await expect
          .poll(() => unreadCount(tabB), { timeout: VISIBLE_WITHIN_MS })
          .toBeGreaterThan(before);
        const visibleB = Date.now() - sentAt;
        // Read by the measurement in docs/architecture/notifications.md.
        console.log(
          `[inbox-push] ${round}: mutation sent -> bell item visible: ${visibleA} ms (stream tab), ${visibleB} ms (other tab)`,
        );

        // Let a stray second fetch or ack show up before counting.
        await tabA.waitForTimeout(3_000);
        expect(inboxGets, `inbox GETs ${round}`).toHaveLength(1);
        expect(localAcks, `local-ack POSTs ${round}`).toHaveLength(1);
      }
    } finally {
      await member.dispose();
    }
  });
});

/** Run `navigate`, then wait for the bell and the open push stream (push is connected). */
async function openApp(
  page: Page,
  navigate: () => Promise<unknown>,
  options: { holdsStream: boolean } = { holdsStream: true },
): Promise<void> {
  // Only the tab that holds the stream opens it; the others hear it over the hub.
  // Context-wide: after a reload the other tab may take the stream over.
  const stream = options.holdsStream
    ? page.context().waitForEvent("request", {
        predicate: (request) => request.url().includes("/api/v1/jmap/events/"),
        timeout: 30_000,
      })
    : null;
  await navigate();
  await expect(page.locator(".notification-inbox-tray__trigger")).toBeVisible({ timeout: 30_000 });
  await stream;
}

/** Wait for the initial fetches (and local-acks of old unread rows) to finish. */
async function expectSettledBell(page: Page): Promise<void> {
  await expect(page.locator(".notification-inbox-tray__trigger")).toBeVisible();
  await page.waitForTimeout(3_000);
}

async function unreadCount(page: Page): Promise<number> {
  const label = await page.locator(".notification-inbox-tray__trigger").getAttribute("aria-label");
  const match = label?.match(/\((\d+) unread\)/);
  return match ? Number(match[1]) : 0;
}

type MemberClient = {
  send: (channelId: string, body: string) => Promise<void>;
  dm: (principal: string) => Promise<string>;
  dispose: () => Promise<void>;
};

async function memberClient(browser: import("@playwright/test").Browser): Promise<MemberClient> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const login = await context.request.post(`${API}/api/v1/auth/token`, {
    data: { username: "member", password: PASSWORD },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const { access_token: token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async dm(principal) {
      const response = await context.request.post(`${API}/api/v1/chat/dms`, {
        headers,
        data: { principal },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return ((await response.json()) as { id: string }).id;
    },
    async send(channelId, body) {
      const response = await context.request.post(
        `${API}/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`,
        { headers, data: { id: newUlid(), body } },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
    },
    dispose: () => context.close(),
  };
}

async function openDmWithAdmin(member: MemberClient): Promise<string> {
  return member.dm("admin");
}

function newUlid(): string {
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
