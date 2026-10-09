import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { setRtcTestOverrides } from "./rtc-test-overrides";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

type MeetE2eWindow = Window & {
  __wgwMeetDcChannels: RTCDataChannel[];
  __wgwMeetDcBlocked: boolean;
  __wgwBlockMeetDc: () => void;
  __wgwMeetDcOpenCount: () => number;
  __meetChatSentAt: number;
  __meetChatArrivedAt: number;
  __meetChatObserver?: MutationObserver;
};

export type MeetGuestSession = {
  context: BrowserContext;
  page: Page;
  accessToken: string | null;
};

/**
 * Records negotiated `meet` channels and the host keydown that sends a line.
 * Installed before navigation so the patch is in place when the mesh builds
 * peer connections.
 */
export async function installMeetDataChannelProbe(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as MeetE2eWindow;
    w.__wgwMeetDcChannels = [];
    w.__wgwMeetDcBlocked = false;
    w.__meetChatSentAt = 0;
    w.__meetChatArrivedAt = 0;
    const orig = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (
      label: string,
      init?: RTCDataChannelInit,
    ) {
      const channel = orig.call(this, label, init);
      if (label === "meet" || init?.id === 1) {
        w.__wgwMeetDcChannels.push(channel);
        if (w.__wgwMeetDcBlocked) queueMicrotask(() => channel.close());
      }
      return channel;
    };
    w.__wgwBlockMeetDc = () => {
      w.__wgwMeetDcBlocked = true;
      for (const channel of w.__wgwMeetDcChannels) {
        try {
          channel.close();
        } catch {
          // Already closed.
        }
      }
    };
    w.__wgwMeetDcOpenCount = () =>
      w.__wgwMeetDcChannels.filter((channel) => channel.readyState === "open").length;
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".meet-workspace__chat-composer"))
          return;
        w.__meetChatSentAt = Date.now();
      },
      true,
    );
  });
}

export async function openSignedInHost(browser: Browser): Promise<MeetGuestSession> {
  const context = await openContext(browser);
  await installMeetDataChannelProbe(context);
  const page = await context.newPage();
  const response = await page.request.post(`${API}/api/v1/auth/token`, {
    data: { username: "admin", password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Login for admin did not return tokens.");
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

export async function openGuest(browser: Browser): Promise<MeetGuestSession> {
  const context = await openContext(browser);
  await installMeetDataChannelProbe(context);
  const page = await context.newPage();
  return { context, page, accessToken: null };
}

export async function createAdHocRoom(page: Page, accessToken: string): Promise<string> {
  const room = newAdHocRoomCode();
  const created = await page.request.post(`${API}/api/v1/chat/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: `Guest chat ${room}`, kind: "meeting", guestRoomCode: room },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return room;
}

/** Signed-in host. The header Meet button covers the case where the URL did not auto-join. */
export async function joinMeetRoom(page: Page, room: string): Promise<void> {
  const join = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
  );
  await setRtcTestOverrides(page.context(), { debug: true, forceRelay: false });
  await page.goto(`/meet/meetings/${room}`);
  const meetButton = page
    .locator(".meet-workspace__header-actions")
    .getByRole("button", { name: "Meet", exact: true });
  void meetButton.click({ timeout: 15_000 }).catch(() => undefined);
  await join;
}

export async function knockAsGuest(page: Page, room: string, name: string): Promise<void> {
  await setRtcTestOverrides(page.context(), { debug: true, forceRelay: false });
  await page.goto(`/meet/meetings/${room}`);
  const nameField = page.getByLabel("Your name");
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  const join = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
  );
  await page.getByRole("button", { name: "Knock to join" }).click();
  await join;
}

export async function admitFirstKnocker(page: Page): Promise<void> {
  await page.getByRole("button", { name: /waiting to join/ }).click();
  await page.getByRole("button", { name: /^Admit / }).click();
}

export async function waitForInCall(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Leave" })).toBeVisible();
}

export async function meetDcOpenCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as MeetE2eWindow).__wgwMeetDcOpenCount());
}

/**
 * Hold SDP offers until the guest is in the call.
 * An offer that arrives while that peer is still a knocker is acked and never
 * answered, so the negotiated channel stays closed.
 */
export async function holdRoomOffers(context: BrowserContext): Promise<{ release: () => void }> {
  let open = false;
  const waiting: Array<() => void> = [];
  await context.route(/\/api\/v1\/rooms\/[^/]+\/events(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const offer =
      request.method() === "POST" && (request.postData() ?? "").includes('"type":"offer"');
    if (offer && !open) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    await route.continue();
  });
  return {
    release() {
      open = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

export async function blockMeetDataChannel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as MeetE2eWindow;
    if (typeof w.__wgwBlockMeetDc !== "function") {
      throw new Error("Meet data-channel probe is missing.");
    }
    w.__wgwBlockMeetDc();
  });
}

/**
 * The composer that actually sends. An expanded call parks channel chat in the
 * open rail; a collapsed call keeps it in the main column.
 */
export function callChatComposer(page: Page): Locator {
  const rail = page.locator(
    '.meet-workspace__rail[data-open="true"] .meet-workspace__chat-composer .ProseMirror',
  );
  const main = page.locator(
    ".meet-workspace__chat-main:not(.meet-workspace__surface--parked) .meet-workspace__chat-composer .ProseMirror",
  );
  return rail.or(main);
}

export async function openCallChat(page: Page): Promise<void> {
  const composer = callChatComposer(page);
  if ((await composer.count()) > 0) return;
  await page.getByRole("button", { name: "Show chat" }).first().click({ timeout: 10_000 });
  await expect(callChatComposer(page).first()).toBeVisible();
}

export async function typeCallChat(page: Page, text: string): Promise<void> {
  await openCallChat(page);
  const composer = callChatComposer(page).first();
  await expect(composer).toBeVisible();
  await composer.click({ timeout: 10_000 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(text);
  await expect(composer).toContainText(text);
}

/**
 * Wall clock on the guest page when `text` first appears in a chat body.
 * Armed before Enter so the stamp is the DOM commit, not a later poll.
 */
export async function armGuestChatArrival(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const w = window as MeetE2eWindow;
    w.__meetChatObserver?.disconnect();
    w.__meetChatArrivedAt = 0;
    const has = () =>
      Array.from(document.querySelectorAll(".chat-message__body")).some((node) =>
        (node.textContent ?? "").includes(needle),
      );
    const mark = () => {
      if (w.__meetChatArrivedAt > 0 || !has()) return;
      w.__meetChatArrivedAt = Date.now();
      w.__meetChatObserver?.disconnect();
    };
    const observer = new MutationObserver(mark);
    w.__meetChatObserver = observer;
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    mark();
  }, text);
}

export async function chatSentAt(page: Page): Promise<number> {
  return page.evaluate(() => (window as MeetE2eWindow).__meetChatSentAt);
}

export async function chatArrivedAt(page: Page): Promise<number> {
  return page.evaluate(() => (window as MeetE2eWindow).__meetChatArrivedAt);
}

export async function chatBodyCount(page: Page, text: string): Promise<number> {
  return page.locator(".chat-message__body", { hasText: text }).count();
}

export function trackRoomMessagePosts(
  page: Page,
  room: string,
  text: string,
): { count: () => number } {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (!request.url().includes(`/api/v1/rooms/${room}/messages`)) return;
    if (!(request.postData() ?? "").includes(text)) return;
    posts += 1;
  });
  return { count: () => posts };
}

async function openContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: APP,
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
    ignoreHTTPSErrors: process.env.WGW_APPS_E2E_IGNORE_HTTPS === "1",
  });
  await setRtcTestOverrides(context, { debug: true, forceRelay: false });
  return context;
}

function newAdHocRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}
