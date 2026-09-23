import { expect, test, type APIRequestContext } from "@playwright/test";

const installBaseURL =
  process.env.WGW_INSTALL_BASE_URL ?? "http://127.0.0.1:9080";

async function isWorkspaceInstalled(request: APIRequestContext): Promise<boolean> {
  const response = await request.get("/api/v1/installer/state");
  if (!response.ok()) {
    return false;
  }
  const body = (await response.json()) as { installed?: boolean };
  return body.installed === true;
}

test.describe("Install wizard", () => {
  test.use({
    baseURL: installBaseURL,
    ignoreHTTPSErrors: true,
  });

  test.beforeEach(async ({ request }, testInfo) => {
    if (await isWorkspaceInstalled(request)) {
      testInfo.skip(
        true,
        "Workspace already installed — install wizard e2e needs a fresh tree (pnpm test:api-e2e:docker)",
      );
    }
  });

  test("GET /install serves the wizard without redirect loop", async ({ request }) => {
    const response = await request.get("/install", { maxRedirects: 5 });

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"] ?? "").toContain("text/html");
    const html = await response.text();
    expect(html).toContain("WeGotWorkspace Installer");
    expect(html).not.toContain("refresh");
  });

  test("GET /install/ loads the installer shell", async ({ page }) => {
    const bootstrap = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/installer/bootstrap") && res.request().method() === "GET",
    );

    await page.goto("/install/", { waitUntil: "domcontentloaded" });

    const bootstrapResponse = await bootstrap;
    expect(bootstrapResponse.ok()).toBeTruthy();

    await expect(page.getByText("An open source workspace, truly yours.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await expect(page.getByText("What you'll set up")).toHaveCount(0);
  });
});
