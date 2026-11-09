// Docs suggestions: a teammate's first reaction must not make them the author.
//
// A suggests while A's thread requests fail, so the suggestion reaches B but its
// thread does not exist yet. The card takes its author from that thread, so B gets
// no reaction picker (whoever wrote first would otherwise create the thread and be
// named as the author). Once A is back, A's session creates the thread; B's 👍
// lands on it, and both tabs show A as the author.
//
// A stays connected to the document room on purpose: fully offline, the
// suggestion itself would not reach B either, so only A's thread writes fail.
import { expect, test, type Page } from "./helpers/live-test";
import { docsUrlForFile, myDriveDocSearchPath, seedDocAtPath } from "./helpers/docs-live";
import { api, OWNER, openUser, TEAMMATE } from "./helpers/live-matrix";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

type StoredThread = {
  changeId?: string;
  createdBy?: { id?: string; name?: string };
  reactions?: { emoji: string; userIds: string[] }[];
};

test.use({ storageState: { cookies: [], origins: [] } });

async function openDoc(page: Page, apiPath: string): Promise<void> {
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText("Hello old world", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible();
}

async function suggestThreads(apiPath: string): Promise<StoredThread[]> {
  const { status, json } = await api(
    OWNER,
    "GET",
    `/files/threads?path=${encodeURIComponent(apiPath)}`,
  );
  expect(status).toBe(200);
  const list = (json as { list?: StoredThread[] }).list ?? [];
  return list.filter((thread) => thread.changeId);
}

async function davDelete(apiPath: string): Promise<void> {
  const encoded = apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const password = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
  await fetch(`${API}/files/${encoded}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${Buffer.from(`${OWNER}:${password}`).toString("base64")}` },
  });
}

test.describe("Docs suggestion reaction author (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a teammate's first reaction keeps the suggester as the author", async ({ browser }) => {
    const fileName = `e2e-suggestion-author-${Date.now()}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    await seedDocAtPath(apiPath, `# ${fileName}\n\nHello old world\n`);
    const shared = await api(OWNER, "POST", "/files/shares", {
      path: apiPath,
      kind: "member",
      defaultAccess: "view",
      shareWith: { [TEAMMATE]: { access: "edit" } },
    });
    expect(shared.status, JSON.stringify(shared.json)).toBeLessThan(300);

    const contextA = await openUser(browser, OWNER);
    const contextB = await openUser(browser, TEAMMATE);
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await openDoc(pageA, apiPath);
      await openDoc(pageB, apiPath);

      // A's thread writes fail from here on; the document room keeps working.
      const threadWrites = "**/api/v1/files/threads**";
      await pageA.route(threadWrites, (route) =>
        route.request().method() === "GET" ? route.fallback() : route.abort("internetdisconnected"),
      );

      await pageA.locator(".docs-collab-suggest-controls").click();
      await expect(pageA.locator(".docs-collab-suggest-controls")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const editorA = pageA.locator(".ProseMirror");
      await editorA.click();
      await editorA.press("End");
      await pageA.keyboard.type(" again");

      // B sees the suggestion, but no reaction picker or reply box while it has no thread.
      const cardB = pageB.locator(".docs-suggestion-card").first();
      await expect(cardB).toBeVisible({ timeout: 30_000 });
      await cardB.click();
      // Long enough for A's settle delay and a failed create.
      await pageB.waitForTimeout(3_000);
      await expect(cardB.getByRole("button", { name: "Add reaction" })).toHaveCount(0);
      await expect(cardB.getByRole("textbox")).toHaveCount(0);
      expect(await suggestThreads(apiPath)).toHaveLength(0);

      // A is back: A's session creates the thread (retry), and B can react.
      await pageA.unroute(threadWrites);
      await expect
        .poll(async () => (await suggestThreads(apiPath)).length, { timeout: 45_000 })
        .toBe(1);
      const addReaction = cardB.getByRole("button", { name: "Add reaction" });
      await expect(addReaction).toBeVisible({ timeout: 45_000 });
      await addReaction.click();
      await pageB.getByRole("button", { name: "👍", exact: true }).click();

      const [thread] = await suggestThreads(apiPath);
      const authorName = thread?.createdBy?.name ?? "";
      expect(authorName).not.toBe("");
      await expect
        .poll(async () => (await suggestThreads(apiPath))[0]?.reactions ?? [], { timeout: 20_000 })
        .toEqual([{ emoji: "👍", userIds: [expect.any(String)] }]);
      const [reacted] = await suggestThreads(apiPath);
      expect(reacted?.reactions?.[0]?.userIds[0]).not.toBe(reacted?.createdBy?.id);

      for (const page of [pageA, pageB]) {
        const card = page.locator(".docs-suggestion-card").first();
        await expect(card.locator(".docs-collab-card__author")).toHaveText(authorName, {
          timeout: 30_000,
        });
        await expect(card.getByRole("button", { name: /^👍 1 / })).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
      await davDelete(apiPath);
    }
  });
});
