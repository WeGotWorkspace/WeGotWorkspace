import { expect, test } from "@playwright/test";

test.describe("Meet lobby smoke", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only UI smoke");

  test("GET /meet?room= serves the meet app shell", async ({ request }) => {
    const response = await request.get("/meet?room=smoke-room");

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"] ?? "").toContain("text/html");

    const html = await response.text();
    expect(html.length).toBeGreaterThan(100);
    expect(html).not.toContain("<b>Fatal error</b>");
  });

  test("GET /meet/guest serves the meet app shell for old bookmarks", async ({ request }) => {
    const response = await request.get("/meet/guest?room=smoke-room");

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"] ?? "").toContain("text/html");
  });

  test("guest lobby renders without React update-depth crash when room is active", async ({
    page,
    request,
  }) => {
    const room = `e2e-${Date.now()}`;
    const join = await request.post(`/api/v1/rooms/${encodeURIComponent(room)}/participants`, {
      data: {
        room,
        peerId: "e2e-host",
        name: "E2E Host",
      },
    });
    test.skip(!join.ok(), "Meet API unavailable (workspace not installed)");

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(`/meet?room=${encodeURIComponent(room)}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Ready to join?")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);

    expect(pageErrors.some((message) => /maximum update depth exceeded/i.test(message))).toBe(
      false,
    );
  });
});
