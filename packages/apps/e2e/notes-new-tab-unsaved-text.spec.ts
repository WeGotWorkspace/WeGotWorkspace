// A new tab must not delete another tab's unsaved text (live app and API, #1722).
//
// Tab A types a sentence. Its save waits two seconds, and this spec holds it
// longer, so the sentence is only in the shared IndexedDB copy. Tab B of the
// same browser context opens the note meanwhile: it loads that copy, then the
// older server snapshot. It used to delete the sentence as a stale local seed,
// and the delete spread to tab A and, on the next save, to the server.
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  api,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  serverNote,
  sleep,
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

const occurrences = (text: string, part: string) => text.split(part).length - 1;

function isBodySave(request: Request, uid: string): boolean {
  return (
    request.method() === "PUT" && new URL(request.url()).pathname.endsWith(`/notes/items/${uid}`)
  );
}

async function openNote(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
}

test("a tab opened while another tab's save is pending keeps that tab's text", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await warmUpApp(browser);
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const path = `/notes/notebooks/${PRIVATE_NOTEBOOK}/${uid}`;
  const sentence = `Typed in tab A ${Date.now()}.`;
  await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: PRIVATE_NOTEBOOK,
    title: `New tab ${uid.slice(0, 8)}`,
    body: "Saved first line.",
  });

  const context = await openUser(browser, OWNER);
  let release: () => void = () => undefined;
  const fresh = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await openNote(a, path);
    const body = a.locator(".ProseMirror").first();

    // A first save gives the server a collaboration state, so tab B adopts a
    // real snapshot below instead of seeding from the text.
    const firstSave = a.waitForResponse((res) => isBodySave(res.request(), uid) && res.ok(), {
      timeout: 60_000,
    });
    await body.click();
    await a.keyboard.press("ControlOrMeta+End");
    await body.pressSequentially(" Saved second line.", { delay: 20 });
    await firstSave;

    // Hold A's next save, so the server snapshot stays older than the shared local copy.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldSaves = 0;
    await a.route(`**/api/v1/notes/items/${uid}`, async (route) => {
      if (!isBodySave(route.request(), uid)) return route.continue();
      heldSaves += 1;
      await held;
      await route.continue();
    });
    await a.keyboard.press("ControlOrMeta+End");
    await body.pressSequentially(` ${sentence}`, { delay: 20 });
    await expect.poll(() => editorText(a)).toContain(sentence);
    // Let y-indexeddb write the update, as the two-second save delay does in real use.
    await sleep(500);

    // Same context, so B loads the shared IndexedDB copy, then the server snapshot.
    const b = await context.newPage();
    b.on("pageerror", (error) => events.push(`B page error: ${String(error).slice(0, 160)}`));
    const snapshotRead = b.waitForResponse(
      (res) => res.url().includes(uid) && res.url().includes("format=yjs"),
      { timeout: 60_000 },
    );
    await openNote(b, path);
    await snapshotRead;
    expect(
      (await serverNote(OWNER, uid))?.body ?? "",
      "the server did not have the sentence when tab B read it",
    ).not.toContain(sentence);
    await sleep(3_000);

    await expect
      .poll(() => editorText(b), { message: "tab B shows A's sentence" })
      .toContain(sentence);
    expect(await editorText(a), "tab A still shows its sentence").toContain(sentence);

    release();
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body ?? "", {
        message: "the held save reaches the server",
        timeout: 60_000,
        intervals: [1_000],
      })
      .toContain(sentence);
    expect(heldSaves, "the spec held A's save").toBeGreaterThan(0);
    await a.unroute(`**/api/v1/notes/items/${uid}`);

    await a.reload();
    await b.reload();
    await a.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
    await b.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
    const c = await openNotesTab(fresh, OWNER, "C", events);
    await openNote(c, path);
    await sleep(3_000);

    for (const [tag, page] of [
      ["tab A after a reload", a],
      ["tab B after a reload", b],
      ["a fresh browser context", c],
    ] as const) {
      await expect
        .poll(async () => occurrences(await editorText(page), sentence), {
          message: `${tag} shows the sentence once`,
        })
        .toBe(1);
    }
    expect(occurrences((await serverNote(OWNER, uid))?.body ?? "", sentence)).toBe(1);
  } finally {
    release();
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await context.close().catch(() => undefined);
    await fresh.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
