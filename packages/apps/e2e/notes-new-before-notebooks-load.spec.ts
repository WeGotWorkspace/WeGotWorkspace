// "New note" pressed before the notebook list has loaded (#2055).
//
// Found by the team simulation: on a first visit, a note started before the
// sidebar showed the notebooks went to a local "Drafts" notebook that does not
// exist on the server. It was never sent, and a reload dropped it.
//
// The notebook list is held back for a few seconds; the note is started at once
// and typed into. It must reach the server in the default notebook and still be
// there after a reload.
import { expect, test } from "./helpers/live-test";
import {
  api,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  serverNote,
  sleep,
  warmUpApp,
} from "./helpers/notes-matrix";

const NOTEBOOKS_DELAY_MS = 4_000;

test.use({ storageState: { cookies: [], origins: [] } });

test("a note started before the notebooks load is saved in the default notebook", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await warmUpApp(browser);
  const marker = `before-notebooks ${Date.now()}`;
  const context = await openUser(browser, OWNER);
  let uid = "";
  try {
    const page = await context.newPage();
    await page.route("**/api/v1/notes/notebooks**", async (route) => {
      await sleep(NOTEBOOKS_DELAY_MS);
      await route.continue().catch(() => undefined);
    });
    await page.goto("/notes");
    const newNote = page.getByRole("button", { name: "New note" });
    await expect(newNote).toBeEnabled({ timeout: 60_000 });
    // The sidebar has no notebooks yet.
    await expect(page.getByRole("button", { name: "General", exact: true })).toHaveCount(0);
    await newNote.click();

    const body = page.locator(".ProseMirror[contenteditable='true']").first();
    await body.waitFor({ timeout: 30_000 });
    await body.click();
    await body.pressSequentially(marker, { delay: 20 });
    await expect.poll(() => new URL(page.url()).pathname.split("/").pop() ?? "").not.toBe("notes");
    uid = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);

    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.notebook ?? null, {
        message: "the note reached the server, in the default notebook",
        timeout: 30_000,
      })
      .toBe(PRIVATE_NOTEBOOK.replace(/^notes-/, ""));
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.body ?? "", {
        message: "the typed text reached the server",
        timeout: 30_000,
      })
      .toContain(marker);

    await page.unroute("**/api/v1/notes/notebooks**");
    await page.reload();
    await expect(page.locator(".list-item__button", { hasText: marker })).toHaveCount(1, {
      timeout: 60_000,
    });
  } finally {
    await context.close().catch(() => undefined);
    if (uid) await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
