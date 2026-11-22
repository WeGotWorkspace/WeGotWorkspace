import { expect, test, type BrowserContext, type Page, type Request } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #2295: Meet chat learns that a call runs in a channel from the `MeetCall` push type, not
 * from a 5 s room-status poll.
 *
 * The owner joins a call in a shared meeting channel over the API (no browser of the owner, so no mesh
 * preview). While push is connected the teammate's open channel must make no room-status
 * request in an idle window (the old poll made one every 5 s), show the call within 8 s
 * of the join, and drop it within 8 s of the leave, each with a handful of room-status
 * reads instead of a steady stream.
 */

const PUSH_BOUND_MS = 8_000;
const IDLE_WINDOW_MS = 16_000;
const PEER_ID = "e2e-call-peer";

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });
test.describe.configure({ timeout: 120_000 });

test("a call in a shared meeting channel shows on the teammate's open chat through push", async ({
  browser,
}) => {
  const channel = await createMeetingChannel();
  let context: BrowserContext | null = null;
  try {
    context = await openUser(browser, TEAMMATE);
    const connected = pushConnected(context);
    const tab = await context.newPage();
    await tab.goto(`/meet/channels/${encodeURIComponent(channel.id)}`);
    await connected;
    // Let the first reads (selection, room resolve) settle.
    await tab.waitForTimeout(4_000);

    const idle = countRoomStatus(tab);
    await tab.waitForTimeout(IDLE_WINDOW_MS);
    const idleReads = idle.stop();
    console.log(
      `[meet-call-doorbell] room-status reads in ${IDLE_WINDOW_MS / 1000} s idle: ${idleReads}`,
    );
    expect(idleReads, "room-status reads in an idle window while push is connected").toBe(0);

    const reads = countRoomStatus(tab);
    const startedAt = Date.now();
    await join(channel.room);
    await expect(callBadge(tab)).toBeVisible({ timeout: PUSH_BOUND_MS });
    const shownMs = Date.now() - startedAt;

    const endedAt = Date.now();
    await leave(channel.room);
    await expect(callBadge(tab)).toBeHidden({ timeout: PUSH_BOUND_MS });
    const hiddenMs = Date.now() - endedAt;
    await tab.waitForTimeout(3_000);
    const total = reads.stop();
    console.log(
      `[meet-call-doorbell] call shown after ${shownMs} ms, gone after ${hiddenMs} ms, room-status reads for both: ${total}`,
    );
    expect(total, "room-status reads for one call start and end").toBeLessThanOrEqual(6);
  } finally {
    await leave(channel.room).catch(() => undefined);
    await context?.close();
  }
});

/** The Join control of the selected channel only shows while its call is active. */
function callBadge(tab: Page) {
  return tab.getByRole("button", { name: /join/i }).first();
}

/**
 * A meeting channel the owner shares with the teammate. Only meeting rooms have a reserved
 * room status, which is what the call badge reads; its room is the channel's guest room code.
 */
async function createMeetingChannel(): Promise<{ id: string; room: string }> {
  const created = await api(OWNER, "POST", "/chat/channels", {
    name: `Doorbell ${Date.now().toString(36)}`,
    kind: "meeting",
  });
  if (created.status !== 201) {
    throw new Error(`Create channel ${created.status}: ${JSON.stringify(created.json)}`);
  }
  const channel = created.json as { id: string; guestRoomCode?: string | null };
  const shared = await api(OWNER, "PATCH", `/chat/channels/${encodeURIComponent(channel.id)}`, {
    shareWith: { [TEAMMATE]: { mayWriteAll: true } },
  });
  if (shared.status !== 200) {
    throw new Error(`Share channel ${shared.status}: ${JSON.stringify(shared.json)}`);
  }
  const room = channel.guestRoomCode ?? channel.id;
  const reserved = await api(OWNER, "POST", "/meetings/rooms", {
    room,
    ownerPrincipal: `u:${OWNER}`,
  });
  if (reserved.status !== 201 && reserved.status !== 200) {
    throw new Error(`Reserve room ${reserved.status}: ${JSON.stringify(reserved.json)}`);
  }
  return { id: channel.id, room };
}

async function join(room: string): Promise<void> {
  const res = await api(OWNER, "POST", `/rooms/${encodeURIComponent(room)}/participants`, {
    peerId: PEER_ID,
    name: "Owner",
  });
  if (res.status !== 200) throw new Error(`Join ${res.status}: ${JSON.stringify(res.json)}`);
}

async function leave(room: string): Promise<void> {
  await api(OWNER, "DELETE", `/rooms/${encodeURIComponent(room)}/participants/${PEER_ID}`);
}

function countRoomStatus(tab: Page): { stop: () => number } {
  let count = 0;
  const onRequest = (request: Request) => {
    if (request.method() === "GET" && /\/api\/v1\/meetings\/rooms\/[^/?]+/.test(request.url())) {
      count += 1;
    }
  };
  tab.on("request", onRequest);
  return {
    stop: () => {
      tab.off("request", onRequest);
      return count;
    },
  };
}

function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
