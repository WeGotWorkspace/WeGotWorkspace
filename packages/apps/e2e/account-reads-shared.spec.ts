// One /settings/state and one /me read per browser (live app, #2321). A fresh
// browser opens five apps at once; the account settings and "who am I" are
// the same answer for all of them, so the server should hear each one once
// (a few at most: a token refresh or a retry may add one), not once per app
// bootstrap.
import { expect, test, type Request } from "./helpers/live-test";
import { openUser, OWNER } from "./helpers/live-matrix";

const APPS = ["/calendar", "/contacts", "/tasks", "/notes", "/docs"];
const LIMIT = 3;

test.describe("Shared account reads (live app)", () => {
  test("five apps opened in a fresh browser read /settings/state and /me once, not per app", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await openUser(browser, OWNER);
    try {
      const counts = { settings: 0, me: 0, total: 0 };
      const onRequest = (request: Request) => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith("/api/v1/")) return;
        counts.total += 1;
        if (request.method() !== "GET") return;
        if (url.pathname === "/api/v1/settings/state") counts.settings += 1;
        if (url.pathname === "/api/v1/me") counts.me += 1;
      };
      context.on("request", onRequest);

      const pages = await Promise.all(APPS.map(() => context.newPage()));
      await Promise.all(pages.map((page, index) => page.goto(APPS[index])));
      await Promise.all(
        pages.map((page) => page.waitForLoadState("networkidle", { timeout: 60_000 })),
      );
      await pages[0].waitForTimeout(3_000);

      console.log(`account reads: ${JSON.stringify(counts)}`);
      expect(counts.settings).toBeLessThanOrEqual(LIMIT);
      expect(counts.me).toBeLessThanOrEqual(LIMIT);
      context.off("request", onRequest);
    } finally {
      await context.close();
    }
  });

  test("a profile save in one tab shows in another tab with no new /settings/state read", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await openUser(browser, OWNER);
    const first = await context.newPage();
    const second = await context.newPage();
    const nameField = first.getByRole("textbox", { name: "Display name" });
    let original = "";
    try {
      await first.goto("/settings/profile");
      await expect(nameField).toBeVisible({ timeout: 30_000 });
      original = await nameField.inputValue();
      await second.goto("/calendar");
      await Promise.all([first, second].map((p) => p.waitForLoadState("networkidle")));

      let reads = 0;
      second.on("request", (request) => {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.pathname === "/api/v1/settings/state") reads += 1;
      });

      const unique = `E2E Name ${Date.now()}`;
      const saved = first.waitForResponse(
        (res) =>
          res.request().method() === "PUT" &&
          new URL(res.url()).pathname === "/api/v1/settings/profile" &&
          res.ok(),
        { timeout: 30_000 },
      );
      await nameField.fill(unique);
      await saved;

      await second.goto("/");
      await expect(second.getByRole("img", { name: `User menu, ${unique}` })).toBeVisible({
        timeout: 30_000,
      });
      expect(reads).toBe(0);
    } finally {
      if (original !== "") {
        const restored = first.waitForResponse(
          (res) =>
            res.request().method() === "PUT" &&
            new URL(res.url()).pathname === "/api/v1/settings/profile" &&
            res.ok(),
          { timeout: 30_000 },
        );
        await nameField.fill(original).catch(() => undefined);
        await restored.catch(() => undefined);
      }
      await context.close();
    }
  });
});
