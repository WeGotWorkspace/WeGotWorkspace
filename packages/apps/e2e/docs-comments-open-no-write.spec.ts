// Opening a Doc with comments writes nothing (live app, #1975).
//
// The comment marks in the document used to be synced against the thread
// list before that list had loaded. Every mark then looked unknown and was
// removed, and added back once the list arrived: two edits, saved on every
// open, with "Saving…" and a "Changes synced" toast although nobody typed.
import * as Y from "yjs";
import { createChatMessageUlid as ulid } from "../src/lib/offline/meet-chat/chat-ulid";
import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { docsUrlForFile, E2E_USERNAME, seedDocAtPath } from "./helpers/docs-live";
import { API, tokenFor } from "./helpers/notifications-live";

const BODY = "Plan for the quiet open check";
const ANCHOR = "quiet open";
/** Well past the save delay (2 s), so a save caused by the open would have gone out. */
const SETTLE_MS = 8_000;

type StoredYjs = { etag: string | null; bytes: Uint8Array };

async function storedYjs(token: string, apiPath: string): Promise<StoredYjs | null> {
  const response = await fetch(
    `${API}/api/v1/files/collaboration?path=${encodeURIComponent(apiPath.replace(/^\/+/, ""))}&format=yjs`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 204) return null;
  expect(response.status, await response.clone().text()).toBe(200);
  return {
    etag: response.headers.get("etag"),
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

/** True when the stored Yjs body carries a comment mark (a `comment` format). */
function hasCommentMark(stored: StoredYjs | null): boolean {
  if (!stored) return false;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, stored.bytes);
  return doc.getXmlFragment("default").toString().includes("comment");
}

type CommentedDoc = { apiPath: string; token: string; before: StoredYjs };

/**
 * A Doc with one open comment whose mark is already stored. The comment comes
 * in through the API, so the first open anchors its mark and saves once; that
 * save is expected and happens here, before the open under test.
 */
async function seedCommentedDoc(context: BrowserContext): Promise<CommentedDoc> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const apiPath = `/users/${E2E_USERNAME}/Quiet open ${run}.md`;
  await seedDocAtPath(apiPath, `${BODY}\n`);
  const token = await tokenFor(E2E_USERNAME);
  const created = await fetch(`${API}/api/v1/files/threads?path=${encodeURIComponent(apiPath)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: ulid(),
      kind: "comment",
      body: `Keep this anchored ${run}`,
      anchorText: ANCHOR,
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);

  const first = await context.newPage();
  await first.goto(docsUrlForFile(apiPath));
  await expect(first.locator(".ProseMirror [data-comment-id]")).toContainText(ANCHOR, {
    timeout: 30_000,
  });
  await expect
    .poll(async () => hasCommentMark(await storedYjs(token, apiPath)), { timeout: 30_000 })
    .toBe(true);
  await expect(first.getByRole("status", { name: "Unsaved changes" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await first.close();
  const before = await storedYjs(token, apiPath);
  if (!before) throw new Error("the first open stored no Yjs state");
  return { apiPath, token, before };
}

/** Records every collaboration save the page sends. */
function watchCollabWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/v1/files/collaboration")) {
      writes.push(request.url());
    }
  });
  return writes;
}

/** After the open has settled: nothing was saved and the mark is still there. */
async function expectNothingWritten(page: Page, doc: CommentedDoc, writes: string[]) {
  await page.waitForTimeout(SETTLE_MS);
  expect(writes, "no collaboration save on a plain open").toEqual([]);
  await expect(page.getByText("Changes synced")).toHaveCount(0);
  await expect(page.locator(".ProseMirror [data-comment-id]")).toContainText(ANCHOR);
  const after = await storedYjs(doc.token, doc.apiPath);
  expect(after?.etag).toBe(doc.before.etag);
  expect(Buffer.from(after?.bytes ?? []).equals(Buffer.from(doc.before.bytes))).toBe(true);
}

test("opening a Doc with an open comment saves nothing", async ({ context }) => {
  const doc = await seedCommentedDoc(context);

  const page = await context.newPage();
  const writes = watchCollabWrites(page);
  let threadsListed = false;
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/v1/files/threads" && response.request().method() === "GET") {
      threadsListed = true;
    }
  });

  await page.goto(docsUrlForFile(doc.apiPath));
  await expect(page.locator(".ProseMirror")).toContainText(BODY, { timeout: 30_000 });
  await expect.poll(() => threadsListed, { timeout: 30_000 }).toBe(true);
  await expect(page.locator(".ProseMirror [data-comment-id]")).toContainText(ANCHOR);
  await expectNothingWritten(page, doc, writes);
  await page.close();
});

test("a failed comment list keeps the marks and saves nothing", async ({ context }) => {
  const doc = await seedCommentedDoc(context);

  const page = await context.newPage();
  const writes = watchCollabWrites(page);
  // Only the thread list fails (a server error); the document itself loads.
  let failedLists = 0;
  await page.route("**/api/v1/files/threads?*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    failedLists += 1;
    await route.fulfill({ status: 503, body: "" });
  });

  await page.goto(docsUrlForFile(doc.apiPath));
  await expect(page.locator(".ProseMirror")).toContainText(BODY, { timeout: 30_000 });
  // The first list and at least one retry from the poll have failed.
  await expect.poll(() => failedLists, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expectNothingWritten(page, doc, writes);
  await page.close();
});
