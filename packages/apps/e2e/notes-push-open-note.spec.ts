// Notes push with the note open (live app). Tab B holds the note's room open and
// has typed text; tab A changes the note's tag and then archives it. B must show
// both changes faster than the 10 s poll, without losing its text or refetching
// the body. Run alone: playwright test --config playwright.live.config.mjs e2e/notes-push-open-note.spec.ts
import { expect, test } from "./helpers/live-test";
import {
  api,
  converge,
  ensureTeamNotebook,
  openNotesTab,
  openUser,
  OWNER,
  sleep,
  TEAM_NOTEBOOK,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

/** Below the 10 s poll, so only a push can make it. */
const PUSH_BOUND_MS = 8_000;

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async ({ browser }) => {
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

/** Change the note the way another client does: against its current etag. */
async function patchNote(uid: string, patch: Record<string, unknown>) {
  const current = await api(OWNER, "GET", `/notes/items/${uid}`);
  const etag = (current.json as { etag?: string }).etag ?? "";
  return api(OWNER, "PATCH", `/notes/items/${uid}`, patch, { "If-Match": etag });
}

test("a tag and an archive reach a tab that has the note open, by push", async ({ browser }) => {
  const id = Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
  const title = `P open ${id}`;
  const uid = crypto.randomUUID();
  const seeded = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: TEAM_NOTEBOOK,
    title,
    body: `body ${id}`,
    categories: [`t-${id}`],
  });
  expect(seeded.status, JSON.stringify(seeded.json)).toBe(201);

  const events: string[] = [];
  const ownerContext = await openUser(browser, OWNER);
  const otherContext = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(ownerContext, OWNER, "A", events);
    const b = await openNotesTab(otherContext, OWNER, "B", events);
    expect(await converge([a, b], uid, 20_000), "both tabs load the note").toEqual({});
    await showAllItems(a);
    await showAllItems(b);

    // B opens the note and types, so its room holds a body newer than the last full fetch.
    const noteGets: string[] = [];
    b.on("request", (request) => {
      const data = request.postData() ?? "";
      if (request.method() === "POST" && data.includes("Note/get") && data.includes(uid)) {
        noteGets.push(data);
      }
    });
    await b.locator(".list-item__button", { hasText: title }).first().click({ timeout: 15_000 });
    await b.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
    await sleep(1_500);
    const editor = b.locator(".ProseMirror").first();
    await editor.waitFor({ timeout: 15_000 });
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially(` typed-${id}`, { delay: 25 });
    await sleep(1_500);
    noteGets.length = 0;

    // A tags the note. B shows the tag by push, not by the poll.
    const tag = `new-${id}`;
    const tagged = await patchNote(uid, {
      categories: [`t-${id}`, tag],
    });
    expect(tagged.status, JSON.stringify(tagged.json)).toBeLessThan(300);
    await expect(
      b.locator(".note-detail-view").getByText(tag, { exact: false }).first(),
      "B's open note shows the new tag before the poll",
    ).toBeVisible({ timeout: PUSH_BOUND_MS });
    await expect(editor, "B keeps the text it typed").toContainText(`typed-${id}`);
    for (const data of noteGets) {
      expect(data, "B's fetch for the open note leaves out the body").not.toMatch(/"body"/);
    }

    // A archives the note. B's open note turns read-only.
    const archived = await patchNote(uid, { status: "CANCELLED" });
    expect(archived.status, JSON.stringify(archived.json)).toBeLessThan(300);
    await expect(editor, "B's open note turns read-only before the poll").toHaveAttribute(
      "contenteditable",
      "false",
      { timeout: PUSH_BOUND_MS },
    );
    await expect(editor, "B still shows its text").toContainText(`typed-${id}`);

    // After a reload the cache matches the server.
    await b.reload();
    await b.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
    await sleep(3_000);
    expect(await converge([a, b], uid, 30_000), "both tabs mirror the server").toEqual({});
  } finally {
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    await ownerContext.close().catch(() => undefined);
    await otherContext.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`);
  }
});
