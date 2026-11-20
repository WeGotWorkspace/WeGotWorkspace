// Docs comments after an expired sync state (live app, #1930).
//
// When the server no longer knows the state the comment poll sends as `since`
// (expired, or from before a server reset), the open document reloads its
// comments once and polls on a fresh state, instead of never updating again
// until a reload. Push is the doorbell (#2286): each step adds a comment from
// the API session, and its `DocThread` push makes the page pull.
import { createChatMessageUlid as ulid } from "../src/lib/offline/meet-chat/chat-ulid";
import { expect, test } from "./helpers/live-test";
import { docsUrlForFile, E2E_USERNAME, seedDocAtPath } from "./helpers/docs-live";
import { pushConnected } from "./helpers/mesh-spy";
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

test("comments added after the sync state expired still appear", async ({ page, context }) => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const apiPath = `/users/${E2E_USERNAME}/Expired comments ${run}.md`;
  await seedDocAtPath(apiPath, `${BODY}\n`);
  const token = await tokenFor(E2E_USERNAME);
  // A first comment gives the document a thread store with a real sync state.
  await addComment(token, apiPath, `Before the reset ${run}`);

  // The test marks the state the poll is on as expired. A poll on it reaches
  // the real API with a state the API cannot read, so the API answers
  // `cannotCalculateChanges` itself. The rewrite stops once the app has
  // started over (a `changes` request without `since`): from then on that
  // state is valid again, even when the fresh state has the same value.
  let expiredState: string | null = null;
  let resynced = false;
  // The state the next pull will send as `since`: the `newState` of the last
  // answer to a pull that itself carried a `since`.
  let nextSince: string | null = null;
  let expiredAnswers = 0;
  await page.route("**/api/v1/files/threads/changes?*", async (route) => {
    const url = new URL(route.request().url());
    const since = url.searchParams.get("since");
    if (expiredState !== null && !resynced) {
      if (since === expiredState) {
        url.searchParams.set("since", `expired-${since}`);
        const response = await route.fetch({ url: url.toString() });
        if (response.status() === 400) expiredAnswers += 1;
        await route.fulfill({ response });
        return;
      }
      if (!since) resynced = true;
    }
    if (!since) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    if (response.ok()) nextSince = ((await response.json()) as { newState: string }).newState;
    await route.fulfill({ response });
  });

  const connected = pushConnected(context);
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText(BODY, { timeout: 30_000 });
  await expect(page.getByText(`Before the reset ${run}`)).toBeVisible({ timeout: 30_000 });
  await connected;

  // Push is the only doorbell: a comment from another session makes the page
  // pull. The first push may pull without `since`, so ring until a pull on a
  // state has happened.
  for (let attempt = 1; nextSince === null; attempt += 1) {
    expect(attempt, "no pull on a sync state after a push").toBeLessThanOrEqual(4);
    const text = `Warm-up ${attempt} ${run}`;
    await addComment(token, apiPath, text);
    await expect(page.getByText(text)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => nextSince, { timeout: 8_000 })
      .not.toBeNull()
      .catch(() => undefined);
  }

  // Another session comments; its push sends the expired state, so only the
  // full reload after `cannotCalculateChanges` can bring that comment in.
  expiredState = nextSince;
  await addComment(token, apiPath, `After the reset ${run}`);
  await expect(page.getByText(`After the reset ${run}`)).toBeVisible({ timeout: 30_000 });
  expect(expiredAnswers).toBeGreaterThan(0);
  expect(resynced).toBe(true);

  // The fresh state keeps working: the next comment arrives on a normal pull.
  const answersBefore = expiredAnswers;
  await addComment(token, apiPath, `On the fresh state ${run}`);
  await expect(page.getByText(`On the fresh state ${run}`)).toBeVisible({ timeout: 30_000 });
  expect(expiredAnswers).toBe(answersBefore);
});
