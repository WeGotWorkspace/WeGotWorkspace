import { expect, test, type BrowserContext, type Page, type Request } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #1667: chat messages the owner posts in a DM reach the teammate's open DM
 * on push, with no mesh between them: the owner posts over the API (like an
 * MCP client or a peer behind a firewall that blocks WebRTC), so no browser
 * of the owner can carry a mesh preview.
 *
 * Bound: 8 s per message. While push is connected the fallback poll runs
 * every 30 s, which the spec checks first (no chat `/changes` call in a 10 s
 * idle window). Three messages in a row then each have to arrive within 8 s,
 * which a 30 s poll cannot do, so a pass proves the push path.
 */

const PUSH_BOUND_MS = 8_000;
const IDLE_WINDOW_MS = 10_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("chat messages posted without a mesh reach the teammate's open DM on push", async ({
  browser,
}) => {
  const run = `push${Date.now().toString(36)}`;
  const channelId = await openDm();
  let context: BrowserContext | null = null;

  try {
    context = await openUser(browser, TEAMMATE);
    const connected = pushConnected(context);
    const tab = await context.newPage();
    const ready = inboundReady(tab);
    await tab.goto(`/meet/dms/${OWNER}`);
    await Promise.all([connected, ready]);

    // The 4 s poll is slowed while push is connected.
    const changes = countChatChanges(tab);
    await tab.waitForTimeout(IDLE_WINDOW_MS);
    expect(changes.stop(), "chat /changes calls in an idle window while push is connected").toBe(0);

    const latencies: number[] = [];
    for (const n of [1, 2, 3]) {
      const body = `${run} message ${n}`;
      const sentAt = Date.now();
      await post(channelId, body);
      await expect(message(tab, body)).toBeVisible({ timeout: PUSH_BOUND_MS });
      latencies.push(Date.now() - sentAt);
    }

    // After a reload the stream must connect again and carry the next message.
    const reconnected = pushConnected(context);
    const readyAgain = inboundReady(tab);
    await tab.reload();
    await Promise.all([reconnected, readyAgain]);
    await expect(message(tab, `${run} message 3`)).toBeVisible();
    const body = `${run} after reload`;
    const sentAt = Date.now();
    await post(channelId, body);
    await expect(message(tab, body)).toBeVisible({ timeout: PUSH_BOUND_MS });
    const reloadMs = Date.now() - sentAt;

    test.info().annotations.push({
      type: "latency",
      description: `messages: ${latencies.join("/")} ms, after reload: ${reloadMs} ms`,
    });
    console.log(
      `[meet-chat-push] owner posts → teammate DM: ${latencies.join("/")} ms, after reload ${reloadMs} ms`,
    );
  } finally {
    await context?.close();
  }
});

/** The thread and the DM's chat panel both render the message. */
function message(tab: Page, body: string) {
  return tab.getByText(body, { exact: true }).first();
}

/** The owner's DM with the teammate (opening it again returns the same channel). */
async function openDm(): Promise<string> {
  const res = await api(OWNER, "POST", "/chat/dms", { principal: TEAMMATE });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Open DM ${res.status}: ${JSON.stringify(res.json)}`);
  }
  return (res.json as { id: string }).id;
}

async function post(channelId: string, body: string): Promise<void> {
  const res = await api(OWNER, "POST", `/chat/channels/${encodeURIComponent(channelId)}/messages`, {
    id: ulid(),
    body,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Post ${res.status}: ${JSON.stringify(res.json)}`);
  }
}

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

function jmapMethods(request: Request): string[] {
  if (!request.url().endsWith("/api/v1/jmap")) return [];
  const calls = (request.postDataJSON() as { methodCalls?: unknown[][] } | null)?.methodCalls;
  return (calls ?? []).map((call) => String(call[0]));
}

/** Counts chat `/changes` calls (the fallback poll, or a push sync) until `stop()`. */
function countChatChanges(tab: Page): { stop: () => number } {
  let count = 0;
  const onRequest = (request: Request) => {
    count += jmapMethods(request).filter((m) => /^Chat(Message|Channel)\/changes$/.test(m)).length;
  };
  tab.on("request", onRequest);
  return {
    stop: () => {
      tab.off("request", onRequest);
      return count;
    },
  };
}

/**
 * Resolves once the live inbound sync runs and the first catch-up is done.
 * Its first calls are a lone `ChatChannel/get` and `ChatMessage/get` with no
 * ids. A message before the catch-up settles lands through it instead of
 * push, so the spec would prove nothing.
 */
async function inboundReady(tab: Page): Promise<void> {
  let lastRequest = Date.now();
  const onRequest = (request: Request) => {
    const url = request.url();
    if (url.endsWith("/api/v1/jmap") || url.includes("/api/v1/chat/")) lastRequest = Date.now();
  };
  tab.on("request", onRequest);
  try {
    await tab.waitForResponse(
      (response) => {
        if (!response.url().endsWith("/api/v1/jmap")) return false;
        const calls = (response.request().postDataJSON() as { methodCalls?: unknown[][] } | null)
          ?.methodCalls;
        if (calls?.length !== 1) return false;
        const [method, args] = calls[0] as [string, { ids?: unknown[] }];
        return method === "ChatMessage/get" && args?.ids?.length === 0;
      },
      { timeout: 60_000 },
    );
    await expect.poll(() => Date.now() - lastRequest, { timeout: 30_000 }).toBeGreaterThan(1_500);
  } finally {
    tab.off("request", onRequest);
  }
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
