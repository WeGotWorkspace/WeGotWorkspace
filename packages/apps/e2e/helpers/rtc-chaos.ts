import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

/** GET `/api/v1/rooms/{id}/events` — the signaling poll the chaos helpers fault. */
const ROOM_EVENTS = /\/api\/v1\/rooms\/[^/]+\/events(?:\?.*)?$/;

export type ChaosSession = {
  context: BrowserContext;
  page: Page;
  accessToken: string;
  username: string;
};

export type RoomEventsChaos = {
  /** How many event polls have been aborted since install. */
  dropped: () => number;
  /** Abort the next `count` event polls. Later polls proceed. */
  dropNext: (count: number) => void;
  dispose: () => Promise<void>;
};

/**
 * Two or three signed-in Chromium contexts. The browser is launched with
 * fake camera and microphone flags by the chaos Playwright config.
 */
export async function openUsers(browser: Browser, usernames: string[]): Promise<ChaosSession[]> {
  if (usernames.length < 2 || usernames.length > 3) {
    throw new Error("The chaos harness opens 2 or 3 contexts.");
  }
  return Promise.all(usernames.map((username) => openSignedInUser(browser, username)));
}

export async function closeSessions(...sessions: ChaosSession[]): Promise<void> {
  await Promise.all(sessions.map((session) => session.context.close()));
}

/** Take the whole context offline (`navigator.onLine` and the network). */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

/** Bring the context back online. */
export async function goOnline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}

/**
 * Fault injection for room event polls.
 * `throttleMs` delays the first poll that follows a dropped one, then stops.
 */
export async function installRoomEventsChaos(
  context: BrowserContext,
  options?: { throttleMs?: number },
): Promise<RoomEventsChaos> {
  let budget = 0;
  let dropped = 0;
  let throttlePending = (options?.throttleMs ?? 0) > 0;
  const throttleMs = options?.throttleMs ?? 0;

  await context.route(ROOM_EVENTS, async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }
    if (budget > 0) {
      budget -= 1;
      dropped += 1;
      await route.abort("failed");
      return;
    }
    if (throttlePending && dropped > 0 && throttleMs > 0) {
      throttlePending = false;
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
    await route.continue();
  });

  return {
    dropped: () => dropped,
    dropNext: (count: number) => {
      budget += count;
    },
    dispose: async () => {
      await context.unroute(ROOM_EVENTS);
    },
  };
}

export function countPcCreated(page: Page): () => number {
  let count = 0;
  page.on("console", (message) => {
    if (message.text().includes("[pc-created]")) count += 1;
  });
  return () => count;
}

export async function createAdHocRoom(page: Page, accessToken: string): Promise<string> {
  const room = newAdHocRoomCode();
  const created = await page.request.post(`${API}/api/v1/chat/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: `Chaos ${room}`, kind: "meeting", guestRoomCode: room },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return room;
}

export async function joinMeetRoom(page: Page, room: string): Promise<void> {
  const join = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
  );
  await page.goto(`/meet/meetings/${room}?rtcDebug=1`);
  const meetButton = page
    .locator(".meet-workspace__header-actions")
    .getByRole("button", { name: "Meet", exact: true });
  void meetButton.click({ timeout: 15_000 }).catch(() => undefined);
  await join;
}

export async function waitForInCall(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();
}

export async function admitFirstKnocker(page: Page): Promise<void> {
  await page.getByRole("button", { name: /waiting to join/ }).click();
  await page.getByRole("button", { name: /^Admit / }).click();
}

export async function waitForRemoteVideo(page: Page): Promise<void> {
  let last = "[]";
  await expect
    .poll(async () => {
      last = await page.evaluate(() =>
        JSON.stringify(
          Array.from(document.querySelectorAll("video.meet-peer-tile__stream")).map((node) => ({
            tile: (node.closest(".meet-peer-tile")?.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 40),
            width: (node as HTMLVideoElement).videoWidth,
          })),
        ),
      );
      const videos = JSON.parse(last) as { tile: string; width: number }[];
      // Local previews are labeled "You" and stay muted. A remote tile with
      // frames is the other person, even when Chrome mutes the element.
      return videos.some((video) => video.width > 2 && !/^You\b/.test(video.tile));
    })
    .toBe(true)
    .catch((error: unknown) => {
      throw new Error(`Remote video did not start (${last})`, { cause: error });
    });
}

/** Put markdown on the drive over WebDAV. `POST /files/content` is not an upload. */
export async function uploadMarkdown(apiPath: string, content: string): Promise<void> {
  const encoded = apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(`${API}/files/${encoded}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(`Upload ${apiPath} failed (${response.status}): ${await response.text()}`);
  }
}

export async function shareWithViewer(
  page: Page,
  apiPath: string,
  username: string,
  access: "view" | "edit" = "view",
): Promise<void> {
  const result = await page.evaluate(
    async ({ path, sharee, grant }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch("/api/v1/files/shares", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path,
          kind: "member",
          defaultAccess: "view",
          shareWith: { [sharee]: { access: grant } },
        }),
      });
      return { ok: response.ok, text: await response.text() };
    },
    { path: apiPath, sharee: username, grant: access },
  );
  expect(result.ok, result.text).toBeTruthy();
}

export async function editorOccurrenceCount(page: Page, needle: string): Promise<number> {
  return page.locator(".ProseMirror").evaluate((editor, expected) => {
    const text = editor.textContent ?? "";
    let count = 0;
    let from = 0;
    while (from <= text.length) {
      const found = text.indexOf(expected, from);
      if (found === -1) break;
      count += 1;
      from = found + expected.length;
    }
    return count;
  }, needle);
}

async function openSignedInUser(browser: Browser, username: string): Promise<ChaosSession> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
    ignoreHTTPSErrors: process.env.WGW_APPS_E2E_IGNORE_HTTPS === "1",
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
  return { context, page, accessToken: tokens.access_token, username };
}

function newAdHocRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}
