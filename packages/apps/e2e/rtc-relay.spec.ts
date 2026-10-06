import {
  expect,
  request as newRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { docsUrlForFile } from "./helpers/docs-live";
import {
  admitFirstKnocker,
  closeSessions,
  createAdHocRoom,
  joinMeetRoom,
  openUsers,
  uploadMarkdown,
  waitForInCall,
  waitForRemoteVideo,
  type ChaosSession,
} from "./helpers/rtc-chaos";
import {
  collectRtcEvents,
  postRelay,
  remoteVideoAdvances,
  selectedLocalTypes,
  withForceRelay,
  type RtcConsoleEvent,
} from "./helpers/rtc-relay";

/**
 * Local coturn relay tier. N4, N5, and N13–N15 stay manual.
 * Every Meet and Docs URL in this file carries `rtcDebug=1`.
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const DIRECT_TYPES = new Set(["host", "srflx", "prflx"]);

test("direct path stays direct", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  const leftLog = collectRtcEvents(left.page);
  const rightLog = collectRtcEvents(right.page);
  try {
    await startAdHocCall(left, right, false);
    await waitForRemoteVideo(left.page);
    await waitForRemoteVideo(right.page);
    await leftLog.waitFor("selected-pair", (event) => event.channel === "meet");
    await rightLog.waitFor("selected-pair", (event) => event.channel === "meet");
    for (const log of [leftLog, rightLog]) {
      const types = selectedLocalTypes(log.events(), "meet");
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) expect(DIRECT_TYPES.has(type)).toBe(true);
      expect(log.events().filter((event) => event.event === "relay-request")).toHaveLength(0);
    }
  } finally {
    await closeSessions(...sessions);
  }
});

test("forced relay — Meet", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  const leftLog = collectRtcEvents(left.page);
  const rightLog = collectRtcEvents(right.page);
  try {
    await startAdHocCall(left, right, true);
    await waitForRemoteVideo(left.page);
    await waitForRemoteVideo(right.page);
    await leftLog.waitFor("selected-pair", meetRelayPair, 45_000);
    await rightLog.waitFor("selected-pair", meetRelayPair, 45_000);
  } finally {
    await closeSessions(...sessions);
  }
});

test("forced relay — Docs", async ({ browser }) => {
  const sentence = `Relay docs ${uniqueId()}`;
  const apiPath = `/users/admin/e2e-relay-docs-${uniqueId()}.md`;
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  const leftLog = collectRtcEvents(left.page);
  const rightLog = collectRtcEvents(right.page);
  try {
    await uploadMarkdown(apiPath, "# Relay\n");
    const url = withForceRelay(`${docsUrlForFile(apiPath)}&rtcDebug=1`);
    await Promise.all([left.page.goto(url), right.page.goto(url)]);
    await expect(left.page.locator(".ProseMirror")).toBeVisible();
    await expect(right.page.locator(".ProseMirror")).toBeVisible();
    await typeIntoDoc(left.page, sentence);
    await expect(right.page.locator(".ProseMirror")).toContainText(sentence, { timeout: 30_000 });
    await leftLog.waitFor("dc-open", (event) => event.channel === "collab", 30_000);
    await rightLog.waitFor(
      "selected-pair",
      (event) => event.channel === "collab" && localType(event) === "relay",
      45_000,
    );
  } finally {
    await closeSessions(...sessions);
  }
});

test("credential refresh keeps the call", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const [left, right] = sessions;
  const leftLog = collectRtcEvents(left.page);
  const rightLog = collectRtcEvents(right.page);
  const leftReasons = trackRelayReasons(left.page);
  const rightReasons = trackRelayReasons(right.page);
  try {
    await startAdHocCall(left, right, true);
    await waitForRemoteVideo(left.page);
    await waitForRemoteVideo(right.page);
    await leftLog.waitFor("selected-pair", meetRelayPair, 45_000);
    await rightLog.waitFor("selected-pair", meetRelayPair, 45_000);
    await flushConsole(left.page);
    await flushConsole(right.page);
    const leftBefore = meetPcCount(leftLog);
    const rightBefore = meetPcCount(rightLog);
    await Promise.any([
      leftLog.waitFor("relay-request", (event) => issuedRefresh(event, leftReasons), 150_000),
      rightLog.waitFor("relay-request", (event) => issuedRefresh(event, rightReasons), 150_000),
    ]);
    await Promise.any([
      leftLog.waitFor("relay-applied", (event) => event.channel === "meet", 30_000),
      rightLog.waitFor("relay-applied", (event) => event.channel === "meet", 30_000),
    ]);
    await flushConsole(left.page);
    await flushConsole(right.page);
    expect(meetPcCount(leftLog), pcCreatedSummary(leftLog)).toBe(leftBefore);
    expect(meetPcCount(rightLog), pcCreatedSummary(rightLog)).toBe(rightBefore);
    await remoteVideoAdvances(left.page);
  } finally {
    await closeSessions(...sessions);
  }
});

test("lobby gets no relay", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const host = sessions[0];
  const guest = await openBlankGuest(browser);
  const guestLog = collectRtcEvents(guest.page);
  try {
    const room = await createAdHocRoom(host.page, host.accessToken);
    await joinMeet(host.page, room, true);
    await waitForInCall(host.page);

    const joined = participantJoin(guest.page, room);
    await knockGuest(guest.page, room, "Ada");
    const guestJoin = await readJoin(await joined);
    expect(guestJoin.sessionKey).toBeTruthy();
    expect(guestJoin.peerId).not.toBe("");

    const denied = await postRelay(guest.page.request, room, {
      peerId: guestJoin.peerId,
      target: "*",
      reason: "precheck",
      sessionKey: guestJoin.sessionKey,
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toBe("relay_denied");

    await admitFirstKnocker(host.page);
    await waitForInCall(guest.page);
    await waitForRemoteVideo(guest.page);
    await guestLog.waitFor("selected-pair", meetRelayPair, 45_000);
  } finally {
    await guest.context.close();
    await closeSessions(...sessions);
  }
});

test("no TURN configured is reported", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "admin"]);
  const admin = sessions[0];
  const api = await newRequest.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${admin.accessToken}` },
  });
  try {
    await putSettings(api, { clearTurnSecret: true });
    try {
      const room = await createAdHocRoom(admin.page, admin.accessToken);
      const joined = participantJoin(admin.page, room);
      await joinMeet(admin.page, room, true);
      await waitForInCall(admin.page);
      const { peerId } = await readJoin(await joined);
      const unavailable = await postRelay(api, room, {
        peerId,
        target: "*",
        reason: "precheck",
      });
      expect(unavailable.status()).toBe(503);
      expect((await unavailable.json()).error).toBe("relay_unavailable");

      const health = await realtimeHealth(api);
      expect(health.turnConfigured).toBe(false);
      expect(health.unavailablePeopleThisWeek).toBeGreaterThanOrEqual(1);
      expect(health.callout).not.toBeNull();
    } finally {
      await putSettings(api, { values: configuredTurn() });
      const restored = await realtimeHealth(api);
      expect(restored.turnConfigured).toBe(true);
    }
  } finally {
    await api.dispose();
    await closeSessions(...sessions);
  }
});

test("leave cleans up", async ({ browser }) => {
  const sessions = await openUsers(browser, ["admin", "member"]);
  const [host, member] = sessions;
  const hostLog = collectRtcEvents(host.page);
  try {
    await startAdHocCall(host, member, true);
    await waitForRemoteVideo(host.page);
    const remoteNames = host.page
      .locator(".meet-peer-tile__name span")
      .filter({ hasNotText: /^You$/ });
    await expect(remoteNames.first()).toBeVisible();
    const name = (await remoteNames.first().innerText()).trim();
    const leftAt = new Date().toISOString();
    await clickLeave(member.page);
    const confirm = member.page.locator(".meet-call-dialog__confirm");
    if (await confirm.isVisible()) await confirm.click();
    await expect
      .poll(
        async () => {
          const texts = await host.page.locator(".meet-peer-tile__name span").allInnerTexts();
          return texts.filter((text) => text.trim() === name).length;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    const failedAfterLeave = hostLog.events().filter((event) => {
      if (event.event !== "peer-connect-failed") return false;
      const at = event.details?.at;
      return typeof at === "string" && at >= leftAt;
    });
    expect(failedAfterLeave.length).toBeLessThanOrEqual(1);
  } finally {
    await closeSessions(...sessions);
  }
});

async function clickLeave(page: Page): Promise<void> {
  const dock = page
    .locator(".meet-call-stage__dock")
    .getByRole("button", { name: "Leave", exact: true });
  if (await dock.isVisible()) {
    await dock.click({ timeout: 15_000 });
    return;
  }
  await page
    .locator(".meet-call-bar")
    .getByRole("button", { name: "Leave", exact: true })
    .click({ timeout: 15_000 });
}

async function startAdHocCall(
  left: ChaosSession,
  right: ChaosSession,
  forceRelay: boolean,
): Promise<void> {
  const room = await createAdHocRoom(left.page, left.accessToken);
  await joinMeet(left.page, room, forceRelay);
  await waitForInCall(left.page);
  await joinMeet(right.page, room, forceRelay);
  if (right.username !== "admin") await admitFirstKnocker(left.page);
  await waitForInCall(right.page);
}

async function joinMeet(page: Page, room: string, forceRelay: boolean): Promise<void> {
  if (!forceRelay) {
    await joinMeetRoom(page, room);
    return;
  }
  const pending = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
  );
  await page.goto(withForceRelay(`/meet/meetings/${room}?rtcDebug=1`));
  const meetButton = page
    .locator(".meet-workspace__header-actions")
    .getByRole("button", { name: "Meet", exact: true });
  void meetButton.click({ timeout: 15_000 }).catch(() => undefined);
  await pending;
}

function participantJoin(page: Page, room: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.ok() &&
      response.url().includes(`/api/v1/rooms/${room}/participants`),
  );
}

async function readJoin(response: Awaited<ReturnType<typeof participantJoin>>) {
  const body = (await response.json()) as { sessionKey?: string | null };
  const posted = response.request().postDataJSON() as { peerId?: string };
  return {
    peerId: posted.peerId ?? "",
    sessionKey: typeof body.sessionKey === "string" ? body.sessionKey : null,
  };
}

async function openBlankGuest(browser: Parameters<typeof openUsers>[0]): Promise<ChaosSession> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
    ignoreHTTPSErrors: process.env.WGW_APPS_E2E_IGNORE_HTTPS === "1",
  });
  const page = await context.newPage();
  return { context, page, accessToken: "", username: "guest" };
}

async function knockGuest(page: Page, room: string, name: string): Promise<void> {
  await page.goto(withForceRelay(`/meet/meetings/${room}?rtcDebug=1`));
  await page.getByLabel("Your name").fill(name);
  const join = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes(`/api/v1/rooms/${room}/participants`),
  );
  await page.getByRole("button", { name: "Knock to join" }).click();
  await join;
}

/** Playwright can deliver `console` after the call is already up. */
async function flushConsole(page: Page): Promise<void> {
  const marker = `console-flush-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const seen = page.waitForEvent("console", {
    predicate: (message) => message.text().includes(marker),
    timeout: 5_000,
  });
  await page.evaluate((token) => {
    console.log(token);
  }, marker);
  await seen;
}

function trackRelayReasons(page: Page): () => string[] {
  const reasons: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/relay")) return;
    try {
      const body = request.postDataJSON() as { reason?: unknown } | null;
      if (body && typeof body.reason === "string") reasons.push(body.reason);
    } catch {
      // A non-JSON relay post is not a refresh.
    }
  });
  return () => reasons.slice();
}

function meetPcCount(log: { events: () => RtcConsoleEvent[] }): number {
  return log.events().filter((event) => event.channel === "meet" && event.event === "pc-created")
    .length;
}

function pcCreatedSummary(log: { events: () => RtcConsoleEvent[] }): string {
  return log
    .events()
    .filter((event) => event.event === "pc-created")
    .map((event) => {
      const mode = event.details?.mode;
      const policy = event.details?.iceTransportPolicy;
      return `${event.channel}:${String(mode)}/${String(policy)}`;
    })
    .join(",");
}

function issuedRefresh(event: RtcConsoleEvent, reasons: () => string[]): boolean {
  return (
    event.channel === "meet" && event.details?.outcome === "issued" && reasons().includes("refresh")
  );
}

function meetRelayPair(event: RtcConsoleEvent): boolean {
  return event.channel === "meet" && localType(event) === "relay";
}

function localType(event: RtcConsoleEvent): string {
  return selectedLocalTypes([event], event.channel)[0] ?? "";
}

function configuredTurn(): Record<string, string> {
  const host = process.env.WGW_TURN_HOST || process.env.TURN_HOST;
  if (!host) throw new Error("WGW_TURN_HOST is required to restore TURN.");
  return {
    rtc_stun_url: `stun:${host}:3478`,
    rtc_turn_url: `turn:${host}:3478?transport=tcp`,
    rtc_turn_secret: process.env.WGW_TURN_SECRET ?? "devsecret",
  };
}

async function putSettings(api: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const response = await api.put(`${API}/api/v1/admin/settings`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function realtimeHealth(api: APIRequestContext): Promise<{
  turnConfigured: boolean;
  unavailablePeopleThisWeek: number;
  callout: string | null;
}> {
  const response = await api.get(`${API}/api/v1/admin/realtime-health`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function typeIntoDoc(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(async () => {
    const current = await editor.innerText();
    if (!current.includes(text)) {
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.insertText(text);
    }
    await expect(editor).toContainText(text, { timeout: 5_000 });
  }).toPass({ timeout: 15_000 });
}

function uniqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
