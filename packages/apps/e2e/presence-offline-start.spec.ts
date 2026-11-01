import { expect, test, type Browser, type BrowserContext, type Page } from "./helpers/live-test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

test.use({ storageState: { cookies: [], origins: [] } });

// #1832: a presence boot that failed at start must run again once the connection
// returns, without a reload, and must not surface an uncaught fetch error.
test("presence starts after an offline start once the connection returns", async ({ browser }) => {
  const admin = await openAs(browser, "admin");
  const member = await openAs(browser, "member");

  try {
    await admin.page.goto("/meet");

    const pageErrors: string[] = [];
    member.page.on("pageerror", (error) => pageErrors.push(error.message));

    let configurationAborts = 0;
    await member.context.route("**/api/v1/rooms/p_workspace/configuration", async (route) => {
      configurationAborts += 1;
      await route.abort("internetdisconnected");
    });

    await member.page.goto("/meet");
    await expect.poll(() => configurationAborts).toBeGreaterThan(0);

    await member.context.setOffline(true);
    await member.context.unroute("**/api/v1/rooms/p_workspace/configuration");
    await member.context.setOffline(false);

    const memberRowOnAdmin = admin.page
      .locator(".meet-direct-message-row")
      .filter({ hasText: "Member" });
    const adminRowOnMember = member.page
      .locator(".meet-direct-message-row")
      .filter({ hasText: "Admin" });
    await expect(memberRowOnAdmin.locator('[data-presence="online"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(adminRowOnMember.locator('[data-presence="online"]')).toBeVisible({
      timeout: 60_000,
    });

    expect(pageErrors.filter((message) => message.includes("Failed to fetch"))).toEqual([]);
  } finally {
    await admin.context.close();
    await member.context.close();
  }
});

async function openAs(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const response = await page.request.post(`${API}/api/v1/auth/token`, {
    data: { username, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) {
    throw new Error(`Login for ${username} did not return tokens.`);
  }
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: tokens.access_token },
  );
  return { context, page };
}
