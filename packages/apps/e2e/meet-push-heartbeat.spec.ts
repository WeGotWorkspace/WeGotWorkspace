// A Meet room behind push (#2287, live app and API). Meet arms no steady room
// poll while push is connected. The tab that holds the push stream names every
// tab's Meet peers on `X-WGW-Rtc-Peers`, so a background Meet tab stays on the
// roster past the 60 s peer timeout with no room poll of its own.
// Run alone: playwright test --config playwright.live.config.mjs e2e/meet-push-heartbeat.spec.ts
import { expect, test } from "./helpers/live-test";
import {
  closeSessions,
  createAdHocRoom,
  joinMeetRoom,
  meetLobby,
  openUsers,
} from "./helpers/rtc-chaos";

test.use({ storageState: { cookies: [], origins: [] } });

const SETTLE_MS = 40_000;
const QUIET_MS = 70_000;

test("a background Meet tab stays on the roster past the peer timeout behind push", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const [host, teammate] = await openUsers(browser, ["admin", "member"]);
  try {
    const room = await createAdHocRoom(host.page, host.accessToken);

    // Tab A holds the push stream.
    const tabA = host.page;
    const firstPush = tabA.waitForRequest(
      (request) => request.method() === "GET" && request.url().includes("/api/v1/jmap/events"),
    );
    await tabA.goto("/docs");
    await firstPush;

    // Tab B joins the room, then A comes back to the front.
    const tabB = await host.context.newPage();
    const joined = tabB.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/rooms/${room}/participants`) &&
        response.status() === 200,
    );
    await joinMeetRoom(tabB, room);
    await joined;
    await tabA.bringToFront();
    // A poll timer armed at join, before push status reached this tab, fires once at
    // 30 s; after it the room has no steady poll.
    await tabA.waitForTimeout(SETTLE_MS);

    const roomPolls: number[] = [];
    tabB.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes(`/api/v1/rooms/${room}/events`)) {
        roomPolls.push(Date.now());
      }
    });
    const peerHeaders: string[] = [];
    tabA.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes("/api/v1/jmap/events")) {
        peerHeaders.push(request.headers()["x-wgw-rtc-peers"] ?? "");
      }
    });

    await tabA.waitForTimeout(QUIET_MS);

    expect(roomPolls).toHaveLength(0);
    expect(peerHeaders.some((header) => header.includes("meet:"))).toBe(true);

    // The room is still live: a teammate who knocks is seen by the host's tab.
    const knock = await teammate.page.goto(`/meet/meetings/${room}`);
    expect(knock).not.toBeNull();
    await expect(meetLobby(tabB)).toBeVisible({ timeout: 10_000 });
  } finally {
    await closeSessions(host, teammate);
  }
});
