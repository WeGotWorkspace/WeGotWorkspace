// Tags on a Drive file (#2402): add, reload, a second tab, offline, undo.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_USERNAME } from "./helpers/notes-live";
import { putDriveFile } from "./helpers/drive-seed";

const RUN = Date.now().toString(36);
const NAME = `Tagged ${RUN}.txt`;
const PLAIN = `Plain ${RUN}.txt`;
const LIST_URL = "/drive?view=folder&path=My%20Drive";

function row(page: Page) {
  return page.locator(".drive-list-row", { hasText: NAME });
}

async function openFile(page: Page) {
  await page.goto(LIST_URL);
  const list = page.getByRole("button", { name: "List view" });
  await expect(list).toBeVisible({ timeout: 30_000 });
  if ((await list.getAttribute("aria-pressed")) !== "true") await list.click();
  await expect(row(page)).toBeVisible({ timeout: 30_000 });
  const details = page.getByRole("button", { name: "Details panel" });
  if ((await details.getAttribute("aria-pressed")) !== "true") await details.click();
  await row(page).click();
}

/** Online, the edit is sent at once: wait for the server's answer, so a reload cannot cut it off. */
async function addTag(page: Page, tag: string, online = true) {
  const panel = page.locator(".drive-detail-panel__tags");
  await panel.getByText("Add a tag").click();
  await page.keyboard.type(tag);
  const sent = online
    ? page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/jmap") &&
          (response.request().postData() ?? "").includes("tagsAdd"),
      )
    : Promise.resolve(null);
  await page.keyboard.press("Enter");
  await sent;
  await expect(panel.getByText(tag, { exact: true })).toBeVisible();
}

test.describe("Drive tags", () => {
  test("a tag is added, survives a reload, shows in a second tab, works offline and undoes", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await putDriveFile(`/users/${E2E_USERNAME}/${NAME}`, `tags ${RUN}\n`, "text/plain");

    await putDriveFile(`/users/${E2E_USERNAME}/${PLAIN}`, `plain ${RUN}\n`, "text/plain");

    await openFile(page);
    await addTag(page, "client-a");
    await expect(row(page).getByTestId("drive-row-tags")).toContainText("client-a");

    await page.reload();
    await expect(row(page).getByTestId("drive-row-tags")).toContainText("client-a", {
      timeout: 30_000,
    });

    const second = await context.newPage();
    await second.goto(LIST_URL);
    await expect(row(second).getByTestId("drive-row-tags")).toContainText("client-a", {
      timeout: 30_000,
    });

    // Offline: the edit shows from the local row and waits in the outbox.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "HEAD" && url.pathname === "/") return route.abort("failed");
      if (url.pathname.includes("/api/v1/")) return route.abort("failed");
      return route.continue();
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await openFile(page);
    await addTag(page, "review", false);
    await page.reload();
    await expect(row(page).getByTestId("drive-row-tags")).toContainText("review", {
      timeout: 30_000,
    });

    // Back online: the outbox flushes and the second tab sees both tags.
    await page.unroute("**/*");
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    await page.reload();
    await expect
      .poll(
        async () => {
          await second.reload();
          return (await row(second).getByTestId("drive-row-tags").textContent()) ?? "";
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toMatch(/client-a.*review|review.*client-a/);

    // The sidebar lists the tags; picking one shows only its files, picking it again goes back.
    const sidebarTag = page.getByRole("button", { name: "client-a", pressed: false });
    await sidebarTag.click();
    await expect(page).toHaveURL(/view=tag/);
    await expect(row(page)).toBeVisible();
    await expect(page.locator(".drive-list-row", { hasText: PLAIN })).toHaveCount(0);
    await page.getByRole("button", { name: "client-a", pressed: true }).click();
    await expect(page).not.toHaveURL(/view=tag/);
    await page.goto(LIST_URL);
    await expect(page.locator(".drive-list-row", { hasText: PLAIN })).toBeVisible();

    // Remove then Undo: the tag is back after a reload.
    await openFile(page);
    await page.getByRole("button", { name: "Remove tag client-a" }).click();
    await page.getByRole("button", { name: /undo/i }).first().click();
    await page.reload();
    await expect(row(page).getByTestId("drive-row-tags")).toContainText("client-a", {
      timeout: 30_000,
    });
  });
});
