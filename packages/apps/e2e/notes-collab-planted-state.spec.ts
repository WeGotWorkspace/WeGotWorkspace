// A stored Yjs state that holds another text than the note the server serves
// is not adopted as if it were the note (#2208, live app and API).
//
// The state comes from a second real note ("Planted" / "Other"), is stored
// over the first one with a framed PUT that names the text "Real" / "Plan",
// and two tabs of the first note must show the served text, with no outside-write
// dialog, and converge after one of them types.
import { expect, test, type Page } from "./helpers/live-test";
import { encodeFramedPayload } from "../src/lib/wire/framed-payload";
import {
  E2E_NOTEBOOK_ID,
  appendToActiveNoteBody,
  loginToNotes,
  waitForNotesListReady,
} from "./helpers/notes-live";

const encoder = new TextEncoder();

async function apiFetch(page: Page, path: string, init: { method: string; body?: unknown }) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    },
    { path, ...init },
  );
}

async function createNote(page: Page, title: string, body: string): Promise<string> {
  const uid = crypto.randomUUID();
  const created = await apiFetch(page, "/notes/items", {
    method: "POST",
    body: { uid, notebookId: E2E_NOTEBOOK_ID, title, body, categories: [] },
  });
  expect(created.status).toBeLessThan(300);
  return uid;
}

async function storedBody(page: Page, id: string): Promise<string> {
  const note = await apiFetch(page, `/notes/items/${encodeURIComponent(id)}`, { method: "GET" });
  return (JSON.parse(note.text) as { body?: string }).body ?? "";
}

/** Open a note from the list by a text its row shows. */
async function openNote(page: Page, rowText: string): Promise<void> {
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await waitForNotesListReady(page);
  const row = page.locator(".list-item__button").filter({ hasText: rowText });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

test("a planted state is not adopted: both tabs show the served text and converge", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const planted = `Planted ${stamp}`;
  const real = `Real ${stamp}`;
  await loginToNotes(page);
  const plantedId = await createNote(page, "Other", planted);
  const realId = await createNote(page, "Plan", real);

  // Open the donor so the app stores its Yjs state, then read that state back.
  await openNote(page, planted);
  const donor = page.locator(".ProseMirror").first();
  await expect(donor).toContainText(planted, { timeout: 30_000 });
  // The app stores a state with a save, so the donor's text has to change.
  await appendToActiveNoteBody(page, " donor");
  await expect
    .poll(async () => (await storedBody(page, plantedId)).trim(), { timeout: 30_000 })
    .toBe(`${planted} donor`);
  const state = await page.evaluate(async (id) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(`/api/v1/notes/items/${encodeURIComponent(id)}?format=yjs`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, plantedId);
  expect(state, "the donor note has a stored state").not.toBeNull();
  const yjsBytes = Uint8Array.from(state!);
  expect(yjsBytes.byteLength).toBeGreaterThan(0);

  // Store it over the other note, with that note's own text.
  const markdown = encoder.encode(real);
  const framed = encodeFramedPayload(
    { documentLen: markdown.byteLength, yjsLen: yjsBytes.byteLength, title: "Plan" },
    [markdown, yjsBytes],
  );
  const put = await page.evaluate(
    async ({ id, bytes }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch(`/api/v1/notes/items/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
          Accept: "application/json",
        },
        body: new Uint8Array(bytes),
      });
      return response.status;
    },
    { id: realId, bytes: Array.from(framed) },
  );
  expect(put).toBeLessThan(300);

  const second = await page.context().newPage();
  await second.goto("/notes");
  await expect(second.getByRole("button", { name: "New note" })).toBeVisible({ timeout: 30_000 });
  await openNote(page, real);
  await openNote(second, real);
  for (const tab of [page, second]) {
    const editor = tab.locator(".ProseMirror").first();
    await expect(editor).toContainText(real, { timeout: 30_000 });
    await expect(editor).not.toContainText(planted);
    await expect(tab.getByRole("dialog")).toHaveCount(0);
  }

  const typed = ` typed${stamp}`;
  const editorA = page.locator(".ProseMirror").first();
  await page.bringToFront();
  await appendToActiveNoteBody(page, typed);
  await expect
    .poll(async () => storedBody(page, realId), { timeout: 30_000 })
    .toContain(`typed${stamp}`);

  await second.reload();
  await expect(second.getByRole("button", { name: "New note" })).toBeVisible({ timeout: 30_000 });
  await openNote(second, real);
  const editorB = second.locator(".ProseMirror").first();
  await expect(editorB).toContainText(`typed${stamp}`, { timeout: 30_000 });
  await expect(editorB).not.toContainText(planted);
  await expect(second.getByRole("dialog")).toHaveCount(0);
  await expect(editorA).toContainText(`typed${stamp}`);
  expect((await storedBody(page, realId)).trim()).toBe(`${real}${typed}`);
});
