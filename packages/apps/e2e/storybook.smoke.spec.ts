import { expect, test } from "@playwright/test";

/** Mock-tier WeGotWorkspace login shell (Shared/WeGotWorkspace → Default). */
const WGW_LOGIN_STORY = "shared-wegotworkspace--default";

test.describe("Apps UI smoke (Storybook)", () => {
  test("WeGotWorkspace mock login story renders sign-in shell", async ({ page }) => {
    await page.goto(`/iframe.html?id=${WGW_LOGIN_STORY}&viewMode=story`);

    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByPlaceholder("yourname")).toBeVisible();
    await expect(page.getByPlaceholder("••••••••")).toBeVisible();
  });
});
