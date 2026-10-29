// A collaborator in another browser who misses updates still converges (live app and API, #1737).
//
// Admin types in a second tab (A2) of a note that tab A1 and a teammate's
// browser (B) also have open. B drops every inbound Yjs update while A2
// types, so only the mesh repair can bring B to the same text: the state
// vector check for missed inserts, the delete-set step 2 for missed deletes.
// Ten seconds is well past the 1.5-second quiet check, and nothing else on a
// WebRTC link resyncs a peer that is already connected.
import { expect, test, type Page } from "@playwright/test";
import {
  droppedSyncUpdates,
  installSyncUpdateDrop,
  startDroppingSyncUpdates,
  stopDroppingSyncUpdates,
} from "./helpers/rtc-sync-update-drop";
import {
  api,
  ensureTeamNotebook,
  openNotesTab,
  openUser,
  OWNER,
  TEAM_NOTEBOOK,
  TEAMMATE,
  warmUpApp,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

/** The editor's text, without collaboration carets and their name labels. */
function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) return "";
    const copy = editor.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('[class*="collaboration-carets"], [class*="collaboration-cursor"]')
      .forEach((node) => node.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

async function openNote(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
}

test("a peer in another browser that drops updates converges without a reload", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await warmUpApp(browser);
  await ensureTeamNotebook();
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const path = `/notes/notebooks/${TEAM_NOTEBOOK}/${uid}`;
  const start = `Starting text ${Date.now()}.`;
  await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: TEAM_NOTEBOOK,
    title: `Missed tail ${uid.slice(0, 8)}`,
    body: start,
  });

  const adminContext = await openUser(browser, OWNER);
  const memberContext = await openUser(browser, TEAMMATE);
  await installSyncUpdateDrop(memberContext);
  try {
    const a1 = await openNotesTab(adminContext, OWNER, "A1", events);
    await openNote(a1, path);
    const a2 = await openNotesTab(adminContext, OWNER, "A2", events);
    await openNote(a2, path);
    const b = await openNotesTab(memberContext, TEAMMATE, "B", events);
    await openNote(b, path);
    for (const page of [a1, a2, b]) {
      await expect.poll(() => editorText(page), { timeout: 60_000 }).toContain(start);
    }

    const body = a2.locator(".ProseMirror").first();
    await body.click();
    await a2.keyboard.press("ControlOrMeta+End");

    // The live link works: B gets a sentence while nothing is dropped.
    await body.pressSequentially(" Warm-up sentence.", { delay: 15 });
    const warm = await editorText(a2);
    await expect
      .poll(() => editorText(b), { message: "B gets updates over the live link", timeout: 30_000 })
      .toBe(warm);

    // B misses every update for the next three sentences.
    await startDroppingSyncUpdates(b);
    const sentences = ["First added sentence.", "Second added sentence.", "Third added sentence."];
    for (const sentence of sentences) {
      await body.pressSequentially(` ${sentence}`, { delay: 15 });
    }
    const typed = await editorText(a2);
    expect(typed).toContain(sentences[2]!);
    await expect
      .poll(() => editorText(a1), { message: "A1 shows A2's text", timeout: 10_000 })
      .toBe(typed);
    await expect
      .poll(() => droppedSyncUpdates(b), { message: "B dropped A2's updates", timeout: 10_000 })
      .toBeGreaterThan(0);
    // Updates are still dropped, so only the repair can bring B up to date.
    await expect
      .poll(() => editorText(b), { message: "B repaired the missed inserts", timeout: 10_000 })
      .toBe(typed);

    // A deletion does not move the state vector; only the delete set repairs it.
    const droppedBefore = await droppedSyncUpdates(b);
    for (let i = 0; i < 12; i += 1) await a2.keyboard.press("Backspace");
    const trimmed = await editorText(a2);
    expect(trimmed.length).toBeLessThan(typed.length);
    await expect
      .poll(() => editorText(a1), { message: "A1 shows the deletion", timeout: 10_000 })
      .toBe(trimmed);
    await expect
      .poll(() => droppedSyncUpdates(b), { message: "B dropped the deletion", timeout: 10_000 })
      .toBeGreaterThan(droppedBefore);
    await expect
      .poll(() => editorText(b), { message: "B repaired the missed deletion", timeout: 10_000 })
      .toBe(trimmed);
    await stopDroppingSyncUpdates(b);
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await adminContext.close().catch(() => undefined);
    await memberContext.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
