// Notes create whose response is lost (live app and API, #1514).
//
// The POST reaches the server and creates the note, then the tab goes away
// before the app reads the response. A second tab in the same browser context
// (same IndexedDB and outbox) retries the create. The client-chosen note UID
// makes that retry return the note the first POST made, so the server holds
// exactly one new note and the list shows it once.
import { expect, test } from "./helpers/live-test";
import {
  api,
  converge,
  listTitles,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  serverNote,
  setTabOffline,
  sleep,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

async function serverCount(): Promise<number> {
  const res = await api(OWNER, "GET", `/notes/items?notebookId=${PRIVATE_NOTEBOOK}`);
  expect(res.status).toBe(200);
  return ((res.json as { list?: unknown[] }).list ?? []).length;
}

/**
 * What still differs between the tab's cache and the server for the note. The
 * body is left out: it was typed into a tab that never saw the create answered,
 * and this spec pins the create, not the body's path to the server.
 */
async function openDiffs(tab: Tab, uid: string, timeoutMs: number) {
  const open = await converge([tab], uid, timeoutMs);
  return Object.fromEntries(
    Object.entries(open)
      .map(([tag, diffs]) => [tag, diffs.filter((diff) => !diff.startsWith("body "))] as const)
      .filter(([, diffs]) => diffs.length > 0),
  );
}

async function showAllItems(tab: Tab) {
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await sleep(500);
}

test("create whose response is lost, then reopened: one note, listed once", async ({ browser }) => {
  test.setTimeout(300_000);
  await warmUpApp(browser);
  const events: string[] = [];
  const marker = `lost-response ${Date.now()}`;
  const context = await openUser(browser, OWNER);
  let uid = "";
  const listed = (rows: string[]) => rows.filter((row) => row.includes(marker)).length;
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await showAllItems(a);
    const serverBefore = await serverCount();

    // The server creates the note; the app never sees the response.
    await a.route("**/api/v1/notes/items", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort("failed");
    });

    // Create offline, then reconnect, so the one create POST goes out on its own.
    await setTabOffline(a, true);
    await a.getByRole("button", { name: "New note" }).click();
    const body = a.locator(".ProseMirror").first();
    await body.waitFor({ timeout: 15_000 });
    await body.click();
    await body.pressSequentially(marker, { delay: 20 });
    await sleep(2_500);
    uid = new URL(a.url()).pathname.split("/").pop() ?? "";
    expect(uid).not.toBe("");
    await setTabOffline(a, false);

    await expect
      .poll(
        async () => {
          if ((await serverNote(OWNER, uid)) !== null) return true;
          // Nudge the outbox runner, as a reconnect does.
          await a.evaluate(() => window.dispatchEvent(new Event("online"))).catch(() => undefined);
          return false;
        },
        { message: "the first POST landed on the server", timeout: 100_000, intervals: [1_000] },
      )
      .toBe(true);
    await a.close();

    // Same context, so the same IndexedDB and outbox. The route was A's only.
    const b = await openNotesTab(context, OWNER, "B", events);
    await showAllItems(b);
    expect(await openDiffs(b, uid, 60_000), "tab B mirrors the server").toEqual({});
    expect(await serverCount(), "the server holds exactly one new note").toBe(serverBefore + 1);
    expect(listed(await listTitles(b)), "tab B lists it once").toBe(1);

    await b.reload();
    await b.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
    await sleep(3_000);
    await showAllItems(b);
    expect(await openDiffs(b, uid, 20_000), "still in sync after a reload").toEqual({});
    expect(await serverCount()).toBe(serverBefore + 1);
    expect(listed(await listTitles(b)), "tab B lists it once after a reload").toBe(1);
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await context.close().catch(() => undefined);
    if (uid) await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
