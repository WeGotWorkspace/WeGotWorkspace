import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

test.use({
  storageState: { cookies: [], origins: [] },
  permissions: ["camera", "microphone"],
});

test("signed-in teammate joins the host ad-hoc room", async ({ browser }) => {
  const title = `E2E ad-hoc ${Date.now()}`;
  const room = newAdHocRoomCode();
  const host = await openAs(browser, "admin");
  const member = await openAs(browser, "member");

  try {
    const created = await host.page.request.post(`${API}/api/v1/chat/channels`, {
      headers: { Authorization: `Bearer ${host.accessToken}` },
      data: { name: title, kind: "meeting", guestRoomCode: room },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    const hostJoin = host.page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
    );
    await host.page.goto(`/meet/meetings/${room}`);
    const meetButton = host.page
      .locator(".meet-workspace__header-actions")
      .getByRole("button", { name: "Meet", exact: true });
    // The host owns the channel, so the invite URL may rewrite to the collection
    // slug. Start the call from the header if that rewrite skipped the auto-join.
    void meetButton.click({ timeout: 15_000 }).catch(() => undefined);
    const hostRequest = await hostJoin;
    expect(roomIdFromParticipantsUrl(hostRequest.url())).toBe(room);

    const memberJoin = member.page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
    );
    await member.page.goto(`/meet/meetings/${room}`);
    const memberRequest = await memberJoin;
    expect(roomIdFromParticipantsUrl(memberRequest.url())).toBe(room);

    await expect(host.page.getByRole("button", { name: "1 waiting to join" })).toBeVisible();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

function newAdHocRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

function roomIdFromParticipantsUrl(url: string): string | null {
  const match = url.match(/\/api\/v1\/rooms\/([^/]+)\/participants\/?$/);
  return match?.[1] ?? null;
}

async function openAs(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page; accessToken: string }> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  const response = await page.request.post(`${API}/api/v1/auth/token`, {
    data: { username, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(`Login for ${username} did not return tokens.`);
  }
  await context.addInitScript(
    ({ access, refresh }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.refresh_token", refresh);
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
  return { context, page, accessToken: tokens.access_token };
}
