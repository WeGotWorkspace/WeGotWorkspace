// Docs comments arrive by push, with the poll as the backup (#2286).
//
// While the push stream is connected, an open document pulls its comment
// changes on a `DocThread` push and does not poll. With push down, the 4 s
// poll takes over.
import { createChatMessageUlid as ulid } from "../src/lib/offline/meet-chat/chat-ulid";
import { DOCS_THREADS_POLL_MS } from "../src/docs-core/src/collab/use-docs-threads-source";
import { expect, test } from "./helpers/live-test";
import { docsUrlForFile, E2E_USERNAME, seedDocAtPath } from "./helpers/docs-live";
import { pushConnected } from "./helpers/mesh-spy";
import { API, tokenFor } from "./helpers/notifications-live";

const BODY = "Plan for the push check";

/** A comment from another session, straight to the API. */
async function addComment(token: string, apiPath: string, text: string): Promise<void> {
  const response = await fetch(`${API}/api/v1/files/threads?path=${encodeURIComponent(apiPath)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: ulid(), kind: "comment", body: text, anchorText: "push check" }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
}

test("comments reach an open document by push, and by the poll when push is down", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const apiPath = `/users/${E2E_USERNAME}/Push comments ${run}.md`;
  await seedDocAtPath(apiPath, `${BODY}\n`);
  const token = await tokenFor(E2E_USERNAME);

  let changesRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/files/threads/changes?")) changesRequests += 1;
  });

  const connected = pushConnected(context);
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText(BODY, { timeout: 30_000 });
  await connected;

  // No 4 s polling while push is connected: at most the first-push pull.
  const before = changesRequests;
  await page.waitForTimeout(DOCS_THREADS_POLL_MS * 2 + 1_000);
  expect(changesRequests - before).toBeLessThanOrEqual(1);

  // A comment from another session arrives without a reload.
  await addComment(token, apiPath, `By push ${run}`);
  await expect(page.getByText(`By push ${run}`)).toBeVisible({ timeout: 15_000 });

  // Push down: new event-stream requests fail, so the hub reports disconnected
  // after its failures and the poll starts. Wait for the first poll request.
  await page.route("**/jmap/events/**", (route) => route.abort());
  const afterPush = changesRequests;
  await expect
    .poll(() => changesRequests, { timeout: 60_000, intervals: [1_000] })
    .toBeGreaterThan(afterPush);

  await addComment(token, apiPath, `By poll ${run}`);
  await expect(page.getByText(`By poll ${run}`)).toBeVisible({ timeout: 15_000 });
});
