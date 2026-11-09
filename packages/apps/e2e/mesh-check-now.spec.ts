import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  cachedAudience,
  meshOpen,
  pushConnected,
  spyCount,
  spyOnMesh,
  writerCreatesTask,
} from "./helpers/mesh-spy";
import {
  api,
  cleanUpCase,
  createList,
  openTasksTab,
  openUser,
  OWNER,
  readAllNotifications,
  shareList,
  showAllTasks,
  sleep,
  TEAMMATE,
  type Tab,
} from "./helpers/tasks-matrix";

/**
 * #1662: after a write, the writer's browser sends `check-now` over the
 * presence mesh, and the peer's push hub asks the server at once instead of
 * waiting for its next retry.
 *
 * Two users in two browsers. The owner writes through the app's own API
 * modules in their open tab (so the app's write hooks run): a task on a list
 * shared with the teammate (silent news, audience from the cached `shareWith`)
 * and a DM to the teammate (active news, audience from `X-Wgw-Notified`). The
 * teammate's open Tasks tab shows the task, and their bell shows the DM.
 *
 * With the mesh up, both land in about 1 s. With the teammate's signaling
 * blocked (no mesh), they still land on push alone, within its retry.
 *
 * A DM sent from the Meet composer still carries its mesh preview
 * (`channel-message`), followed by a `check-now`.
 */

const MESH_BOUND_MS = 1_500;
const PUSH_BOUND_MS = 8_000;
const ROUNDS = 3;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });
test.describe.configure({ timeout: 240_000 });

for (const mesh of ["up", "blocked"] as const) {
  test(`a shared task and a DM reach the peer with the mesh ${mesh}`, async ({ browser }) => {
    const id = `cn${mesh}${Date.now().toString(36)}`;
    const events: string[] = [];
    const contexts: BrowserContext[] = [];

    try {
      await readAllNotifications(TEAMMATE);
      const listId = await createList(`L ${id}`);
      await shareList(listId, TEAMMATE, "write");
      const dm = await api(TEAMMATE, "POST", "/chat/dms", { principal: OWNER });
      expect(dm.status, JSON.stringify(dm.json)).toBeLessThan(300);
      const channelId = (dm.json as { id: string }).id;

      const writerContext = await openUser(browser, OWNER);
      const observerContext = await openUser(browser, TEAMMATE);
      contexts.push(writerContext, observerContext);
      for (const context of contexts) await context.addInitScript(spyOnMesh);
      if (mesh === "blocked")
        await observerContext.route("**/api/v1/rooms/p_workspace/**", (route) => route.abort());

      const connected = pushConnected(observerContext);
      const writer = await openTasksTab(writerContext, "writer", events, OWNER);
      const observer = await openTasksTab(observerContext, "observer", events, TEAMMATE);
      await showAllTasks(observer);
      await connected;
      await openBell(observer);

      // The writer knows who shares the list once its first download is cached.
      await expect
        .poll(() => cachedAudience(writer, listId), { timeout: 30_000 })
        .toContain(TEAMMATE);
      if (mesh === "up") {
        await expect.poll(() => meshOpen(writer), { timeout: 60_000 }).toBeGreaterThan(0);
        await expect.poll(() => meshOpen(observer), { timeout: 60_000 }).toBeGreaterThan(0);
      }

      const taskMs: number[] = [];
      const dmMs: number[] = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        // A random phase against the event source's retry, and past the writer's throttle.
        await sleep(2_500 + Math.round(Math.random() * 3_000));
        const title = `task ${round} ${id}`;
        const taskStart = Date.now();
        await writerCreatesTask(writer, listId, title);
        await expect(observer.locator(".tasks-main-view__title", { hasText: title })).toBeVisible({
          timeout: PUSH_BOUND_MS,
        });
        taskMs.push(Date.now() - taskStart);

        await sleep(2_500 + Math.round(Math.random() * 3_000));
        const body = `dm ${round} ${id}`;
        const dmStart = Date.now();
        await writerSendsDm(writer, channelId, body);
        await expect(
          observer.locator(".notification-inbox-tray__popover").getByText(body, { exact: false }),
        ).toBeVisible({ timeout: PUSH_BOUND_MS });
        dmMs.push(Date.now() - dmStart);
      }

      const received = await spyCount(observer, "checkNow");
      const summary = `mesh ${mesh}: task ${taskMs.join("/")} ms, DM ${dmMs.join("/")} ms, check-now received ${received}`;
      test.info().annotations.push({ type: "latency", description: summary });
      console.log(`[mesh-check-now] ${summary}`);

      if (mesh === "up") {
        expect(received, "check-now messages the observer received").toBeGreaterThanOrEqual(
          ROUNDS * 2,
        );
        for (const ms of [...taskMs, ...dmMs]) expect(ms).toBeLessThan(MESH_BOUND_MS);
      } else {
        expect(received).toBe(0);
        for (const ms of [...taskMs, ...dmMs]) expect(ms).toBeLessThan(PUSH_BOUND_MS);
      }
      expect(events.filter((line) => line.includes("page error"))).toEqual([]);
    } finally {
      for (const context of contexts) await context.close().catch(() => undefined);
      await cleanUpCase(id).catch(() => undefined);
    }
  });
}

test("a Meet DM still sends its mesh preview, with a check-now after it", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const writerContext = await openUser(browser, OWNER);
    const observerContext = await openUser(browser, TEAMMATE);
    contexts.push(writerContext, observerContext);
    for (const context of contexts) await context.addInitScript(spyOnMesh);
    const writer = (await writerContext.newPage()) as Tab;
    const observer = (await observerContext.newPage()) as Tab;
    await writer.goto(`/meet/dms/${TEAMMATE}`);
    await observer.goto(`/meet/dms/${OWNER}`);
    await expect.poll(() => meshOpen(writer), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => meshOpen(observer), { timeout: 60_000 }).toBeGreaterThan(0);

    const body = `preview ${Date.now().toString(36)}`;
    const composer = writer.getByRole("textbox", { name: /^Message / }).first();
    await composer.click();
    await writer.keyboard.type(body);
    const sentAt = Date.now();
    await writer.keyboard.press("Enter");
    await expect(observer.getByText(body, { exact: true }).first()).toBeVisible({
      timeout: MESH_BOUND_MS,
    });
    const shownMs = Date.now() - sentAt;
    await expect.poll(() => spyCount(observer, "previews")).toBeGreaterThan(0);
    await expect.poll(() => spyCount(observer, "checkNow")).toBeGreaterThan(0);
    test.info().annotations.push({ type: "latency", description: `preview: ${shownMs} ms` });
    console.log(`[mesh-check-now] Meet DM preview → peer: ${shownMs} ms`);
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
  }
});

async function writerSendsDm(tab: Tab, channelId: string, body: string): Promise<void> {
  await tab.evaluate(
    async ({ channel, text, messageId }) => {
      const path = "/src/lib/api/wgw/meet-chat.ts";
      const module = (await import(/* @vite-ignore */ path)) as {
        sendChatMessage(channelId: string, body: { id: string; body: string }): Promise<unknown>;
      };
      await module.sendChatMessage(channel, { id: messageId, body: text });
    },
    { channel: channelId, text: body, messageId: ulid() },
  );
}

async function openBell(tab: Tab): Promise<void> {
  await tab.locator(".notification-inbox-tray__trigger").click();
  await expect(tab.locator(".notification-inbox-tray__popover")).toBeVisible();
}

/** Chat message ids are ULIDs (26 Crockford base32 characters). */
function ulid(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i += 1) {
    head = alphabet[time % 32] + head;
    time = Math.floor(time / 32);
  }
  let tail = "";
  for (let i = 0; i < 16; i += 1) tail += alphabet[Math.floor(Math.random() * 32)];
  return head + tail;
}
