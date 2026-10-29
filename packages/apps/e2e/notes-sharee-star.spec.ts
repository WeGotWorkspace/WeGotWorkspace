// A view-only sharee stars a shared note (live app). The star is theirs alone:
// it survives a reload, the owner never sees it, and an unstar made offline
// reaches the server on reconnect without a PATCH a view-only sharee would be refused.
import { expect, test } from "@playwright/test";
import {
  api,
  openNotesTab,
  openUser,
  OWNER,
  setTabOffline,
  sleep,
  TEAMMATE,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

test.setTimeout(240_000);

async function starredIds(user: string): Promise<string[]> {
  const res = await api(user, "GET", "/notes/items?starred=true");
  const list = (res.json as { list?: Array<{ id: string }> })?.list ?? [];
  return list.map((note) => note.id);
}

async function openNote(tab: Tab, title: string) {
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await tab.locator(".list-item__button", { hasText: title }).first().click({ timeout: 30_000 });
  await tab.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
  await sleep(1_000);
}

async function starredViewTitles(tab: Tab): Promise<string> {
  await tab.getByRole("button", { name: "Starred", exact: true }).click();
  await sleep(1_000);
  return (await tab.locator(".list-item__button").allTextContents()).join("|");
}

test("a view-only sharee stars a shared note, online and offline", async ({ browser }) => {
  await warmUpApp(browser);
  const stamp = Date.now().toString(36);
  const title = `Sharee star ${stamp}`;
  const notebook = await api(OWNER, "POST", "/notes/notebooks", { name: `Star book ${stamp}` });
  const notebookId = (notebook.json as { id: string }).id;
  const created = await api(OWNER, "POST", "/notes/items", { notebookId, title, body: "body" });
  const uid = (created.json as { id: string }).id;
  const shared = await api(OWNER, "PATCH", `/notes/notebooks/${notebookId}`, {
    shareWith: { [TEAMMATE]: { mayReadItems: true } },
  });
  expect(shared.status).toBe(200);

  const events: string[] = [];
  const sharee = await openUser(browser, TEAMMATE);
  const owner = await openUser(browser, OWNER);
  try {
    const tab = await openNotesTab(sharee, TEAMMATE, "sharee", events);
    await openNote(tab, title);
    const star = tab.getByRole("button", { name: "Star", exact: true });
    await expect(star).toBeEnabled();
    await star.click();
    await expect.poll(() => starredIds(TEAMMATE), { timeout: 30_000 }).toContain(uid);

    await tab.reload();
    await tab.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
    expect(await starredViewTitles(tab)).toContain(title);

    const ownerTab = await openNotesTab(owner, OWNER, "owner", events);
    expect(await starredIds(OWNER)).not.toContain(uid);
    expect(await starredViewTitles(ownerTab)).not.toContain(title);

    // Offline unstar, then reconnect.
    await openNote(tab, title);
    await setTabOffline(tab, true);
    await tab.getByRole("button", { name: "Star", exact: true }).click();
    await sleep(4_000); // past the 2.5 s undo delay, so the save lands in the outbox
    expect(await starredIds(TEAMMATE)).toContain(uid);
    await setTabOffline(tab, false);
    await expect.poll(() => starredIds(TEAMMATE), { timeout: 60_000 }).not.toContain(uid);

    await tab.reload();
    await tab.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
    expect(await starredViewTitles(tab)).not.toContain(title);
    expect(events.filter((event) => event.includes("page error"))).toEqual([]);
  } finally {
    await sharee.close().catch(() => undefined);
    await owner.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`);
  }
});
