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
        if (url.pathname.endsWith("/settings/state")) counts.settings += 1;
        if (url.pathname.endsWith("/me")) counts.me += 1;
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

  test("a settings write in one tab is what another open tab reads next, with no new request", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await openUser(browser, OWNER);
    try {
      const first = await context.newPage();
      const second = await context.newPage();
      await first.goto("/tasks");
      await second.goto("/calendar");
      await Promise.all([first, second].map((p) => p.waitForLoadState("networkidle")));

      let reads = 0;
      second.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname.endsWith("/settings/state")
        )
          reads += 1;
      });
      // What `saveSettingsProfile` does with the server's answer.
      await first.evaluate(async () => {
        const http = await import(/* @vite-ignore */ "/src/lib/api/wgw/http.ts");
        http.wgwSettingsStateRead.set({ marker: "written-in-first-tab", groups: [] });
      });
      await expect
        .poll(
          () =>
            second.evaluate(async () => {
              const http = await import(/* @vite-ignore */ "/src/lib/api/wgw/http.ts");
              const read = await http.wgwSettingsStateRead.read();
              return read.ok ? read.json.marker : "not-ok";
            }),
          { timeout: 10_000 },
        )
        .toBe("written-in-first-tab");
      expect(reads).toBe(0);
    } finally {
      await context.close();
    }
  });
});
