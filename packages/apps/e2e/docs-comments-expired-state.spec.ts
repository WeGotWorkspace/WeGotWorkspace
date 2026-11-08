// Docs comments after an expired sync state (live app, #1930).
//
// When the server no longer knows the state the comment poll sends as `since`
// (expired, or from before a server reset), the open document reloads its
// comments once and polls on a fresh state, instead of never updating again
// until a reload.
import { createChatMessageUlid as ulid } from "../src/lib/offline/meet-chat/chat-ulid";
import { expect, test } from "./helpers/live-test";
import { docsUrlForFile, E2E_USERNAME, seedDocAtPath } from "./helpers/docs-live";
import { API, tokenFor } from "./helpers/notifications-live";

const BODY = "Plan for the expired state check";

/** A comment from another session, straight to the API. */
async function addComment(token: string, apiPath: string, text: string): Promise<void> {
  const response = await fetch(`${API}/api/v1/files/threads?path=${encodeURIComponent(apiPath)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: ulid(), kind: "comment", body: text, anchorText: "expired state" }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
}

test("comments added after the sync state expired still appear", async ({ page }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const apiPath = `/users/${E2E_USERNAME}/Expired comments ${run}.md`;
  await seedDocAtPath(apiPath, `${BODY}\n`);
  const token = await tokenFor(E2E_USERNAME);
  // A first comment gives the document a thread store with a real sync state.
  await addComment(token, apiPath, `Before the reset ${run}`);

  // A poll on a state the test marks as forgotten reaches the real API with a
  // state it cannot read, so the API answers `cannotCalculateChanges` itself.
  // The mark ends at the client's resync (a poll without `since`).
  const forgotten = new Set<string>();
  let lastSince: string | null = null;
  let expiredAnswers = 0;
  await page.route("**/api/v1/files/threads/changes?*", async (route) => {
    const url = new URL(route.request().url());
    const since = url.searchParams.get("since");
    // A poll without `since` is the client's resync: the state is forgotten
    // only until then, so a fresh state that equals the old token works again.
    if (!since) forgotten.clear();
    if (since && forgotten.has(since)) {
      url.searchParams.set("since", `expired-${since}`);
      const response = await route.fetch({ url: url.toString() });
      if (response.status() === 400) expiredAnswers += 1;
      await route.fulfill({ response });
      return;
    }
    if (since) lastSince = since;
    await route.continue();
  });

  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText(BODY, { timeout: 30_000 });
  await expect(page.getByText(`Before the reset ${run}`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => lastSince, { timeout: 30_000 }).not.toBeNull();

  forgotten.add(lastSince!);
  await expect.poll(() => expiredAnswers, { timeout: 30_000 }).toBeGreaterThan(0);
  await addComment(token, apiPath, `After the reset ${run}`);
  await expect(page.getByText(`After the reset ${run}`)).toBeVisible({ timeout: 30_000 });

  // The fresh state keeps working: the next comment arrives on a normal poll.
  const answersBefore = expiredAnswers;
  await addComment(token, apiPath, `On the fresh state ${run}`);
  await expect(page.getByText(`On the fresh state ${run}`)).toBeVisible({ timeout: 30_000 });
  expect(expiredAnswers).toBe(answersBefore);
});
