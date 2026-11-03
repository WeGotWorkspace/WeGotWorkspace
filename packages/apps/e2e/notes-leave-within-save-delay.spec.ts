// Leaving a note or document within the autosave delay must not lose the text
// (live app and API).
//
// The sentence is typed, and the person moves to another note (or the Docs
// home) within one second, before the save timer fires. Leaving saves the body
// in the background. Another browser context must then see the sentence, and
// the leaving context must show it once when it opens the note again.
import { expect, test, type Page, type Request } from "./helpers/live-test";
import {
  docsUrlForFile,
  myDriveDocSearchPath,
  loginToDocs,
  seedDocAtPath,
} from "./helpers/docs-live";
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

/** A save that carries the sentence in its body. */
function savesSentence(request: Request, pathPart: string, sentence: string): boolean {
  if (request.method() !== "PUT" || !request.url().includes(pathPart)) return false;
  return (request.postDataBuffer()?.toString("utf8") ?? "").includes(sentence);
}

async function openEditor(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
}

test("a note left within the save delay reaches the server once", async ({ browser }) => {
  test.setTimeout(240_000);
  await warmUpApp(browser);
  const events: string[] = [];
  const run = Date.now().toString(36);
  const uidX = crypto.randomUUID();
  const uidY = crypto.randomUUID();
  const titleX = `Leave X ${run}`;
  const titleY = `Leave Y ${run}`;
  const sentence = `Typed just before leaving ${Date.now()}.`;
  for (const [uid, title] of [
    [uidX, titleX],
    [uidY, titleY],
  ] as const) {
    const created = await api(OWNER, "POST", "/notes/items", {
      uid,
      notebookId: PRIVATE_NOTEBOOK,
      title,
      body: "Saved first line.",
    });
    expect(created.status).toBe(201);
  }
  const pathX = `/notes/notebooks/${PRIVATE_NOTEBOOK}/${uidX}`;

  const owner = await openUser(browser, OWNER);
  const other = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(owner, OWNER, "A", events);
    await openEditor(a, pathX);
    const body = a.locator(".ProseMirror").first();
    await body.click();
    await a.keyboard.press("ControlOrMeta+End");

    const backgroundSave = a.waitForRequest(
      (r) => savesSentence(r, `/notes/items/${uidX}`, sentence),
      {
        timeout: 60_000,
      },
    );
    await body.pressSequentially(` ${sentence}`, { delay: 10 });
    // Within the save delay: the timer has not fired yet.
    await a.locator(".list-item__button", { hasText: titleY }).first().click({ timeout: 15_000 });
    await backgroundSave;

    await expect
      .poll(async () => (await serverNote(OWNER, uidX))?.body ?? "", {
        message: "the server has the sentence",
        timeout: 60_000,
        intervals: [1_000],
      })
      .toContain(sentence);

    const b = await openNotesTab(other, OWNER, "B", events);
    await openEditor(b, pathX);
    await expect.poll(() => editorText(b), { timeout: 30_000 }).toContain(sentence);

    await a.locator(".list-item__button", { hasText: titleX }).first().click({ timeout: 15_000 });
    await a.locator(".ProseMirror").first().waitFor({ timeout: 30_000 });
    await sleep(3_000);
    await expect
      .poll(async () => occurrences(await editorText(a), sentence), {
        message: "the leaving context shows the sentence once",
      })
      .toBe(1);
    expect(occurrences((await serverNote(OWNER, uidX))?.body ?? "", sentence)).toBe(1);
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await owner.close().catch(() => undefined);
    await other.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uidX}`).catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uidY}`).catch(() => undefined);
  }
});

test("a document left for the Docs home within the save delay reaches the server", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const fileName = `e2e-leave-${Date.now()}.md`;
  const searchPath = myDriveDocSearchPath(fileName);
  const sentence = `Typed just before leaving ${Date.now()}.`;
  await seedDocAtPath(`/${searchPath}`, "# Leave seed\n");

  const owner = await openUser(browser, OWNER);
  const other = await openUser(browser, OWNER);
  try {
    const a = await owner.newPage();
    await loginToDocs(a, searchPath);
    const editor = a.locator(".ProseMirror").first();
    await editor.click();
    await a.keyboard.press("ControlOrMeta+End");

    const backgroundSave = a.waitForRequest((r) => savesSentence(r, "/files/", sentence), {
      timeout: 60_000,
    });
    await editor.pressSequentially(` ${sentence}`, { delay: 10 });
    // Within the save delay: the timer has not fired yet.
    await a.getByText("Back to docs home").first().click();
    await backgroundSave;

    const b = await other.newPage();
    await b.goto(docsUrlForFile(`/${searchPath}`));
    await b.locator(".ProseMirror").first().waitFor({ timeout: 60_000 });
    await expect.poll(() => editorText(b), { timeout: 30_000 }).toContain(sentence);
  } finally {
    await owner.close().catch(() => undefined);
    await other.close().catch(() => undefined);
  }
});
