// Meet chat sync matrix (live app, #1565). Chat on the shared offline engine:
// a channel's history opens from the cache with no network, a message sent
// offline is queued and sent on reconnect (also after an offline reload), a
// second tab sees it at once, a send the server refuses for good stays queued
// with its status instead of passing as sent, and changes made elsewhere
// reach the cache through the channel's stored token.
//
// The offline-reload cases need the production build (the dev server has no
// offline app shell): run with WGW_E2E_PRODUCTION_BUILD=1, which serves
// `vite preview` (see playwright.matrix.config.mjs). Without it they skip.
// Run one case with --grep "reload".
import { expect, test, type Request } from "./helpers/live-test";
import {
  api,
  openUser,
  OWNER,
  setTabOffline,
  sleep,
  TEAMMATE,
  type Tab,
} from "./helpers/live-matrix";

const MIRROR_MS = 30_000;
const PRODUCTION_BUILD = process.env.WGW_E2E_PRODUCTION_BUILD === "1";
const needsOfflineShell = () =>
  test.skip(!PRODUCTION_BUILD, "an offline reload needs the production build");

test.use({ actionTimeout: 15_000, storageState: { cookies: [], origins: [] } });

// --- server -------------------------------------------------------------------------------------

/** A client message id: 26 characters of Crockford base32, time first. */
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

async function ok(res: { status: number; json: unknown }, what: string): Promise<unknown> {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${what} ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

const rights = (mayWrite: boolean) => ({
  mayRead: true,
  mayWrite,
  mayShare: false,
  mayDelete: false,
});

/** A channel of the owner's, shared with the teammate when `teammate` says how. */
async function createChannel(name: string, teammate?: "write" | "read"): Promise<string> {
  const created = (await ok(
    await api(OWNER, "POST", "/chat/channels", { name, kind: "channel" }),
    "create channel",
  )) as { id: string };
  if (teammate) await shareWithTeammate(created.id, teammate === "write");
  return created.id;
}

async function shareWithTeammate(channelId: string, mayWrite: boolean): Promise<void> {
  await ok(
    await api(OWNER, "PATCH", `/chat/channels/${encodeURIComponent(channelId)}`, {
      shareWith: { [TEAMMATE]: rights(mayWrite) },
    }),
    "share channel",
  );
}

async function post(channelId: string, body: string): Promise<string> {
  const id = ulid();
  await ok(
    await api(OWNER, "POST", `/chat/channels/${encodeURIComponent(channelId)}/messages`, {
      id,
      body,
    }),
    "post",
  );
  return id;
}

async function deleteMessage(id: string): Promise<void> {
  await ok(await api(OWNER, "DELETE", `/chat/messages/${encodeURIComponent(id)}`), "delete");
}

type ServerMessage = { id: string; body: string; deletedAt?: string | null };

async function serverMessages(channelId: string): Promise<ServerMessage[]> {
  const res = (await ok(
    await api(OWNER, "GET", `/chat/channels/${encodeURIComponent(channelId)}/messages?limit=200`),
    "list",
  )) as { list: ServerMessage[] };
  return res.list;
}

async function serverBodies(channelId: string): Promise<string[]> {
  return (await serverMessages(channelId)).filter((row) => !row.deletedAt).map((row) => row.body);
}

async function deleteChannel(channelId: string): Promise<void> {
  await api(OWNER, "DELETE", `/chat/channels/${encodeURIComponent(channelId)}`).catch(
    () => undefined,
  );
}

// --- the tab ------------------------------------------------------------------------------------

type CachedMessage = { id: string; body: string; deleted: boolean; pending: boolean };
type OutboxRow = {
  op: string;
  messageId: string | null;
  lastStatus: number | null;
  retries: number;
};
type TabCache = { messages: CachedMessage[]; outbox: OutboxRow[]; token: string | null };

/** The tab's chat cache for one channel (by its REST id; DMs are not used here). */
async function tabCache(tab: Tab, channelId: string): Promise<TabCache> {
  return tab.evaluate(async (channel) => {
    const user = localStorage.getItem("wgw.offline.meet-chat.username");
    const empty = { messages: [], outbox: [], token: null };
    if (!user) return empty;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes("meet_chat_messages")) {
      db.close();
      return empty;
    }
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => resolve([]);
      });
    const messages = (
      await all<{ id: string; channelId: string; data: string; pendingSync: boolean }>(
        "meet_chat_messages",
      )
    )
      .filter((row) => row.channelId === channel)
      .map((row) => {
        const message = JSON.parse(row.data) as { body: string; deletedAt?: number | null };
        return {
          id: row.id,
          body: message.body,
          deleted: Boolean(message.deletedAt),
          pending: row.pendingSync,
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const outbox = (
      await all<{
        domain: string;
        op: string;
        payload: string;
        lastStatus?: number;
        retries: number;
        createdAt: number;
      }>("outbox")
    )
      .filter((row) => row.domain === "meet-chat")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        op: row.op,
        messageId: (JSON.parse(row.payload) as { messageId?: string }).messageId ?? null,
        lastStatus: row.lastStatus ?? null,
        retries: row.retries,
      }));
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    return {
      messages,
      outbox,
      token: meta.find((row) => row.key === `meet-chat:state:${channel}`)?.value ?? null,
    };
  }, channelId);
}

const pollCache = (
  tab: Tab,
  channelId: string,
  pick: (cache: TabCache) => unknown,
  message: string,
) =>
  expect.poll(async () => pick(await tabCache(tab, channelId)), {
    message,
    timeout: MIRROR_MS,
    intervals: [1_000],
  });

const bodies = (cache: TabCache) => cache.messages.filter((m) => !m.deleted).map((m) => m.body);

/** Opens a channel and waits until its history is in the cache (the first backfill is done). */
async function openChannel(
  context: Awaited<ReturnType<typeof openUser>>,
  user: string,
  channelId: string,
  tag = "A",
): Promise<Tab> {
  const tab = (await context.newPage()) as Tab;
  tab.tag = tag;
  tab.user = user;
  await tab.goto(`/meet/channels/${channelId}`);
  await expect(composer(tab)).toBeVisible({ timeout: 60_000 });
  await pollCache(
    tab,
    channelId,
    (c) => c.token !== null,
    "the first backfill stored a token",
  ).toBe(true);
  return tab;
}

function composer(tab: Tab) {
  return tab.getByRole("textbox").last();
}

async function send(tab: Tab, body: string): Promise<void> {
  const box = composer(tab);
  await box.fill(body);
  await box.press("Enter");
}

const shown = (tab: Tab, body: string) => tab.getByText(body, { exact: true }).first();

/**
 * The service worker has the app shell: a first visit has to finish installing
 * it before an offline reload can work, for a person as for the test.
 */
async function shellCached(tab: Tab): Promise<void> {
  await tab.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

/** Offline reload: the service worker serves the shell, the cache the history. */
async function reloadOffline(tab: Tab): Promise<void> {
  await tab.reload();
  await expect(composer(tab)).toBeVisible({ timeout: 30_000 });
}

/** The `since` tokens of the tab's REST message pulls from now on. */
function watchPulls(tab: Tab) {
  const calls = { sinces: [] as string[] };
  tab.on("requestfinished", (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/chat/messages/changes")) {
      calls.sinces.push(url.searchParams.get("since") ?? "");
    }
  });
  return calls;
}

function run(): string {
  return `cm${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

// --- the matrix ---------------------------------------------------------------------------------

test.describe("meet chat offline", () => {
  test.describe.configure({ timeout: 180_000 });

  test("cold offline open · a channel's history shows from the cache", async ({ browser }) => {
    needsOfflineShell();
    const id = run();
    const channelId = await createChannel(`${id} history`);
    const context = await openUser(browser, OWNER);
    try {
      await post(channelId, `${id} first`);
      await post(channelId, `${id} second`);
      const tab = await openChannel(context, OWNER, channelId);
      await pollCache(tab, channelId, bodies, "the history is cached").toEqual([
        `${id} first`,
        `${id} second`,
      ]);

      await shellCached(tab);
      await setTabOffline(tab, true);
      await reloadOffline(tab);
      await expect(shown(tab, `${id} first`)).toBeVisible();
      await expect(shown(tab, `${id} second`)).toBeVisible();
    } finally {
      await context.close();
      await deleteChannel(channelId);
    }
  });

  for (const via of ["reconnect", "offline reload, then reconnect"] as const) {
    test(`send offline · queued, then sent · ${via}`, async ({ browser }) => {
      if (via !== "reconnect") needsOfflineShell();
      const id = run();
      const channelId = await createChannel(`${id} send`);
      const context = await openUser(browser, OWNER);
      try {
        const tab = await openChannel(context, OWNER, channelId);
        await shellCached(tab);
        await setTabOffline(tab, true);
        await send(tab, `${id} written offline`);
        await expect(shown(tab, `${id} written offline`)).toBeVisible();
        await pollCache(tab, channelId, (c) => c.outbox.map((row) => row.op), "queued").toEqual([
          "send",
        ]);
        expect(await serverBodies(channelId)).toEqual([]);

        if (via !== "reconnect") {
          await reloadOffline(tab);
          await expect(shown(tab, `${id} written offline`)).toBeVisible();
        }
        await setTabOffline(tab, false);

        await pollCache(tab, channelId, (c) => c.outbox.length, "the queue drains").toBe(0);
        expect(await serverBodies(channelId)).toEqual([`${id} written offline`]);
        await pollCache(tab, channelId, (c) => c.messages.map((m) => m.pending), "sent").toEqual([
          false,
        ]);
        // Sent once: the client id is the idempotency key.
        expect((await serverMessages(channelId)).length).toBe(1);
      } finally {
        await context.close();
        await deleteChannel(channelId);
      }
    });
  }

  test("second tab · a message sent offline in one tab shows in the other at once", async ({
    browser,
  }) => {
    const id = run();
    const channelId = await createChannel(`${id} tabs`);
    const context = await openUser(browser, OWNER);
    try {
      const first = await openChannel(context, OWNER, channelId, "A");
      const second = await openChannel(context, OWNER, channelId, "B");
      // Both offline: the tabs share the cache, and the message shows in both.
      await setTabOffline(first, true);
      await setTabOffline(second, true);
      await send(first, `${id} from tab A`);
      await expect(shown(second, `${id} from tab A`)).toBeVisible({ timeout: 10_000 });

      await setTabOffline(first, false);
      await setTabOffline(second, false);
      await pollCache(first, channelId, (c) => c.outbox.length, "the queue drains").toBe(0);
      expect(await serverBodies(channelId)).toEqual([`${id} from tab A`]);
    } finally {
      await context.close();
      await deleteChannel(channelId);
    }
  });

  test("second tab · a message one tab pulls shows in the other tab, which is offline", async ({
    browser,
  }) => {
    const id = run();
    const channelId = await createChannel(`${id} pulled`);
    const context = await openUser(browser, OWNER);
    try {
      const online = await openChannel(context, OWNER, channelId, "A");
      const offline = await openChannel(context, OWNER, channelId, "B");
      await setTabOffline(offline, true);
      await post(channelId, `${id} posted elsewhere`);
      await expect(shown(online, `${id} posted elsewhere`)).toBeVisible({ timeout: MIRROR_MS });
      // Tab B has no network: only tab A's notice can bring the message over.
      await expect(shown(offline, `${id} posted elsewhere`)).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
      await deleteChannel(channelId);
    }
  });

  test("refused · a queued send to a channel that became read-only stays queued with its 403", async ({
    browser,
  }) => {
    const id = run();
    const channelId = await createChannel(`${id} refused`, "write");
    const context = await openUser(browser, TEAMMATE);
    try {
      const tab = await openChannel(context, TEAMMATE, channelId);
      await setTabOffline(tab, true);
      await send(tab, `${id} too late`);
      await pollCache(tab, channelId, (c) => c.outbox.map((row) => row.op), "queued").toEqual([
        "send",
      ]);
      // The main chat column (the call rail keeps a second, closed one).
      const sent = tab
        .locator(".workspace-app-layout__main-content")
        .locator("article.chat-message", { hasText: `${id} too late` });
      await expect(sent.locator(".chat-message__sync")).toHaveText("Sending…");

      await shareWithTeammate(channelId, false);
      await setTabOffline(tab, false);

      await pollCache(
        tab,
        channelId,
        (c) => c.outbox.map((row) => `${row.op} ${row.lastStatus} ${row.retries > 0}`),
        "the refusal is recorded on the queued row",
      ).toEqual(["send 403 true"]);
      expect(await serverBodies(channelId)).toEqual([]);
      // The person's text stays, still marked as not sent.
      expect((await tabCache(tab, channelId)).messages.map((m) => [m.body, m.pending])).toEqual([
        [`${id} too late`, true],
      ]);
      // On screen: the message reads "Not sent" and Meet shows the sync notice with Retry.
      await expect(sent.locator(".chat-message__sync")).toHaveText("Not sent", {
        timeout: 15_000,
      });
      const notice = tab.getByRole("region", { name: "Needs your attention" });
      await expect(notice).toContainText("Some changes could not sync", { timeout: 15_000 });
      await expect(notice.getByRole("button", { name: "Retry" })).toBeVisible();
    } finally {
      await context.close();
      await deleteChannel(channelId);
    }
  });

  test("inbound · a message posted and one deleted elsewhere arrive through the token · reload", async ({
    browser,
  }) => {
    const id = run();
    const channelId = await createChannel(`${id} inbound`);
    const context = await openUser(browser, OWNER);
    try {
      await post(channelId, `${id} keep`);
      const doomed = await post(channelId, `${id} doomed`);
      const tab = await openChannel(context, OWNER, channelId);
      await pollCache(tab, channelId, bodies, "loaded").toEqual([`${id} keep`, `${id} doomed`]);
      const before = (await tabCache(tab, channelId)).token;

      // The live JMAP poll starts from the server's state on every load, so
      // changes made before the reload reach the cache through the token alone.
      await setTabOffline(tab, true);
      await deleteMessage(doomed);
      await post(channelId, `${id} new`);
      await sleep(500);
      await setTabOffline(tab, false);
      const calls = watchPulls(tab);
      await tab.reload();

      await pollCache(tab, channelId, bodies, "the cache mirrors").toEqual(
        await serverBodies(channelId),
      );
      expect(await serverBodies(channelId)).toEqual([`${id} keep`, `${id} new`]);
      expect(calls.sinces, "pulled from the stored token").toContain(before);
      await expect(shown(tab, `${id} new`)).toBeVisible();
      await expect(tab.getByText(`${id} doomed`, { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
      await deleteChannel(channelId);
    }
  });
});
