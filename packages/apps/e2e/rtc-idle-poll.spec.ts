// Idle room polls (#2156, live app and API). A colleague's page that goes away
// without its leave beacon stays on the room roster until the server times it
// out (90 s). It used to hold every room it shared at the 1.2 s connecting
// poll (and a browser whose WebRTC stays down for good). Now a peer that has
// not linked within 20 s no longer counts, and a newcomer is still found
// within the 2 s empty-room poll. Run alone: playwright test
// --config playwright.live.config.mjs e2e/rtc-idle-poll.spec.ts
import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/live-test";
import {
  api,
  ensureTeamNotebook,
  openNotesTab,
  openUser,
  OWNER,
  sleep,
  TEAM_NOTEBOOK,
  TEAMMATE,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

/**
 * A closed page's data channel looks open until ICE consent fails (about 22 s
 * in Chromium); the drop starts a fresh 20 s dial window. 60 s is past both
 * and still well inside the server's 90 s peer timeout, so on the old code the
 * ghost is still listed and still holds the 1.2 s poll.
 */
const PAST_DIAL_WINDOW_MS = 60_000;
const MEASURE_MS = 12_000;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await ensureTeamNotebook();
  await warmUpApp(browser);
});

type Poll = { room: string; at: number };

function recordRoomPolls(page: Page): Poll[] {
  const polls: Poll[] = [];
  page.on("request", (request) => {
    const match = /\/api\/v1\/rooms\/([^/?]+)\/events/.exec(request.url());
    if (match && request.method() === "GET") polls.push({ room: match[1]!, at: Date.now() });
  });
  return polls;
}

async function openNote(tab: Tab, title: string): Promise<void> {
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await tab.locator(".list-item__button", { hasText: title }).first().click({ timeout: 20_000 });
  await tab.locator(".ProseMirror").first().waitFor({ timeout: 20_000 });
}

/**
 * Watches A's polls of the note room. `newPeerOf(user)` resolves with the time
 * a roster first lists a peer of `user` that no earlier roster had: the ghost
 * of a closed page stays listed until the server times it out.
 */
function watchNoteRoster(page: Page) {
  const known = new Set<string>();
  let waiter: { user: string; resolve: (at: number) => void } | null = null;
  page.on("response", async (response) => {
    if (!/\/api\/v1\/rooms\/f_[^/?]+\/(events|participants)/.test(response.url())) return;
    if (response.status() !== 200) return;
    const body = (await response.json().catch(() => null)) as {
      peers?: Array<{ id: string; user?: string }>;
    } | null;
    for (const peer of body?.peers ?? []) {
      if (known.has(peer.id)) continue;
      known.add(peer.id);
      if (waiter && peer.user === waiter.user) waiter.resolve(Date.now());
    }
  });
  return {
    newPeerOf: (user: string) =>
      new Promise<number>((resolve) => {
        waiter = { user, resolve };
      }),
  };
}

test("a vanished colleague stops holding the note at the fast poll, a newcomer is still found fast", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const title = `Idle poll ${Math.random().toString(36).slice(2, 8)}`;
  const seeded = await api(OWNER, "POST", "/notes/items", {
    uid: crypto.randomUUID(),
    notebookId: TEAM_NOTEBOOK,
    title,
    body: "idle",
  });
  expect(seeded.status, JSON.stringify(seeded.json)).toBe(201);

  const events: string[] = [];
  const contextA = await openUser(browser, OWNER);
  const contextB = await openUser(browser, TEAMMATE);
  try {
    const a = await openNotesTab(contextA, OWNER, "A", events);
    const polls = recordRoomPolls(a);
    const roster = watchNoteRoster(a);
    await openNote(a, title);
    const b = await openNotesTab(contextB, TEAMMATE, "B", events);
    await openNote(b, title);
    await sleep(6_000);

    // B goes away without a leave: closing the context sends no beacon.
    await contextB.close();
    await sleep(PAST_DIAL_WINDOW_MS);

    const from = Date.now();
    await sleep(MEASURE_MS);
    const window = polls.filter((poll) => poll.at >= from);
    const noteRoom = window.filter((poll) => poll.room.startsWith("f_"));
    // 2 s while nobody reachable is in the room: 6 in 12 s. The 1.2 s connecting poll made 10.
    expect(noteRoom.length, `note room polls: ${noteRoom.length}`).toBeLessThanOrEqual(7);
    expect(noteRoom.length).toBeGreaterThanOrEqual(4);
    for (const room of new Set(window.map((poll) => poll.room))) {
      if (!room.startsWith("p_")) continue;
      const count = window.filter((poll) => poll.room === room).length;
      // Team room: 4 s alone (or 20 s linked). The ghost used to keep it at 1.2 s.
      expect(count, `${room} polls: ${count}`).toBeLessThanOrEqual(4);
    }

    // A newcomer is found within the empty-room poll, as before.
    const contextC = await openUser(browser, TEAMMATE);
    try {
      const seen = roster.newPeerOf(TEAMMATE);
      const c = await openNotesTab(contextC, TEAMMATE, "C", events);
      let joinedAt = Number.NaN;
      c.on("response", (response) => {
        if (!Number.isNaN(joinedAt) || response.request().method() !== "POST") return;
        if (/\/api\/v1\/rooms\/f_[^/?]+\/participants$/.test(response.url())) joinedAt = Date.now();
      });
      await openNote(c, title);
      const seenAt = await Promise.race([seen, sleep(10_000).then(() => Number.NaN)]);
      const latency = Math.max(0, seenAt - joinedAt);
      expect(Number.isNaN(joinedAt), "C never joined the note room").toBe(false);
      expect(Number.isNaN(seenAt), "A never listed the newcomer").toBe(false);
      expect(latency, `A found C after ${latency} ms`).toBeLessThan(3_500);
    } finally {
      await contextC.close();
    }
    expect(events).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close().catch(() => undefined);
  }
});
