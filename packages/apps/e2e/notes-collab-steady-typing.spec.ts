// Saving while someone keeps typing (live app and API, #1533). Tab A types a
// marker with a gap under the 2 s debounce between every key. The server and
// tab B's list must hold a prefix of it before the typing ends, and the rest
// must be saved with no further keystroke. Run alone: playwright test --config
// playwright.live.config.mjs e2e/notes-collab-steady-typing.spec.ts
import { expect, test } from "./helpers/live-test";
import {
  api,
  converge,
  ensureTeamNotebook,
  openNotesTab,
  openUser,
  OWNER,
  serverNote,
  sleep,
  TEAM_NOTEBOOK,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

/** SAVE_MAX_WAIT_MS is 3 s; the rest is slack for the request and the list refresh. */
const FIRST_SAVE_BOUND_MS = 6_000;
const KEY_GAP_MS = 250;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await ensureTeamNotebook();
  await warmUpApp(browser);
});

async function showAllItems(tab: Tab) {
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await sleep(500);
}

test("a save lands while typing continues, and the tail follows without a keystroke", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const id = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
  const title = `Steady ${id}`;
  const marker = `${id}steadytypingmarkerthatkeepsgoing`.slice(0, 40);
  const prefix = marker.slice(0, 8);
  const uid = crypto.randomUUID();
  const seeded = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: TEAM_NOTEBOOK,
    title,
    body: "x",
  });
  expect(seeded.status, JSON.stringify(seeded.json)).toBe(201);

  const events: string[] = [];
  const contextA = await openUser(browser, OWNER);
  const contextB = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(contextA, OWNER, "A", events);
    const b = await openNotesTab(contextB, OWNER, "B", events);
    expect(await converge([a, b], uid, 20_000), "both tabs load the note").toEqual({});
    await showAllItems(a);
    await showAllItems(b);

    await a.locator(".list-item__button", { hasText: title }).first().click({ timeout: 15_000 });
    await a.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
    await sleep(1_500);
    const editor = a.locator(".ProseMirror").first();
    await editor.waitFor({ timeout: 15_000 });
    await editor.click();
    await editor.press("End");

    const startedAt = Date.now();
    let typingDone = false;
    const typing = editor
      .pressSequentially(marker, { delay: KEY_GAP_MS })
      .then(() => (typingDone = true));

    // Mid-burst: the server holds a prefix of the marker.
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body ?? "", {
        message: "the server holds part of the text while typing continues",
        timeout: FIRST_SAVE_BOUND_MS,
        intervals: [500],
      })
      .toContain(prefix);
    expect(typingDone, "that save came before the typing ended").toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(FIRST_SAVE_BOUND_MS + 1_000);

    // Mid-burst: tab B's list excerpt shows it too.
    await expect(
      b.locator(".list-item__button", { hasText: title }).first(),
      "B's list shows the text before the typing ends",
    ).toContainText(prefix, { timeout: FIRST_SAVE_BOUND_MS });
    expect(typingDone, "B showed it before the typing ended").toBe(false);

    // No further key: the follow-up save carries the tail.
    await typing;
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body ?? "", {
        message: "the server holds the full text without another keystroke",
        timeout: 8_000 + 2_000,
        intervals: [500],
      })
      .toContain(marker);

    for (const tab of [a, b]) {
      await tab.reload();
      await tab.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
      await sleep(2_000);
    }
    expect(await converge([a, b], uid, 30_000), "both tabs mirror the server").toEqual({});
    await showAllItems(a);
    await a.locator(".list-item__button", { hasText: title }).first().click({ timeout: 15_000 });
    await expect(a.locator(".ProseMirror").first()).toContainText(marker, { timeout: 15_000 });
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await contextA.close().catch(() => undefined);
    await contextB.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
