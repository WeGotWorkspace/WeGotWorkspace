// Docs offline gaps (live app, #1563 step 2).
//
// 1. An offline create whose name meanwhile exists on the server keeps both.
// 2. A Doc renamed while an editor has it open offline: the text follows the file,
//    for a rename in another tab of this browser and for one from another device.
// 3. Starred and Trash work offline: star, unstar, trash, restore; permanent
//    delete and Shared with me say they need a connection.
// 4. "Changes synced" only shows once changes reached the server.
// 5. No "Failed to fetch" and no uncaught error anywhere on Docs home offline.
import { expect, test, type BrowserContext, type Page, type Route } from "./helpers/live-test";
import {
  appendToActiveDocBody,
  docsHomeRow,
  docsUrlForFile,
  expectOfflineIndicator,
  gotoDocsHome,
  seedDocAtPath,
} from "./helpers/docs-live";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const HOME = `/users/${E2E_USERNAME}`;
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;
const davUrl = (apiPath: string) =>
  `${API}/files/${apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

/** A file's text from outside the tab; null when it is not there. */
async function serverText(apiPath: string): Promise<string | null> {
  const res = await fetch(davUrl(apiPath), { headers: { Authorization: basicAuth } });
  return res.ok ? res.text() : null;
}

/**
 * Fresh names per attempt, so a retry never meets the last attempt's files.
 * No `x`: typed into the editor, "6x9" becomes "6×9" and the token no longer matches.
 */
const run = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.replaceAll("x", "k");

/** Uncaught errors and "Failed to fetch" console errors, for the end-of-test check. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && /Failed to fetch|Uncaught/i.test(message.text())) {
      errors.push(`console: ${message.text().slice(0, 300)}`);
    }
  });
  return errors;
}

/** Records every toast with whether the tab was online when it appeared. */
async function recordToasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { text: string; online: boolean }[] = [];
    (window as unknown as { __toasts: typeof log }).__toasts = log;
    const seen = new WeakSet<Node>();
    new MutationObserver(() => {
      document.querySelectorAll("[data-sonner-toast]").forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        log.push({ text: element.textContent ?? "", online: navigator.onLine });
      });
    }).observe(document, { childList: true, subtree: true });
  });
}

async function toasts(page: Page, text: string): Promise<{ text: string; online: boolean }[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __toasts?: { text: string; online: boolean }[] }).__toasts ?? [],
  );
  return all.filter((toast) => toast.text.includes(text));
}

/**
 * Which file the editor shows. Opened by path, that is `?file=`. Opened by
 * FileNode id (#1751), the URL keeps `?id=` across a rename, so read the file
 * name from the tab title instead.
 */
async function editorShows(page: Page): Promise<string> {
  return new URL(page.url()).searchParams.get("file") ?? (await page.title());
}

const ID_URL = /[?&]id=(fn-[0-9a-f]{32})/;

function editorNodeId(page: Page): string {
  return ID_URL.exec(page.url())?.[1] ?? "";
}

/** Star and trash run once their Undo toast closes; wait for that. */
async function undoWindowsClosed(page: Page): Promise<void> {
  await expect(page.locator("[data-sonner-toast]", { hasText: "Undo" })).toHaveCount(0, {
    timeout: 20_000,
  });
}

function sidebarView(page: Page, name: string) {
  return page.locator(".docs-workspace").getByRole("button", { name, exact: true }).first();
}

async function openRowMenu(page: Page, fileName: string) {
  await docsHomeRow(page, fileName).getByRole("button", { name: "More actions" }).click();
  return page.getByRole("menu");
}

async function renameFromRow(page: Page, fileName: string, nextBase: string): Promise<void> {
  const menu = await openRowMenu(page, fileName);
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename document" });
  await dialog.getByRole("textbox").fill(nextBase);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
}

async function goOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  await expectOfflineIndicator(page);
}

async function openEditor(page: Page, apiPath: string): Promise<void> {
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible();
  // Let the room settle and the Drive cache learn the file before going offline.
  await page.waitForTimeout(3000);
}

test("gap 1: an offline create whose name was taken on the server keeps both", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const base = `Gaps create ${run()}`;
  const token = `offline-create-${run()}`;
  await gotoDocsHome(page);
  await page.waitForTimeout(2000);
  await goOffline(context, page);

  await page.getByRole("button", { name: "New document" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("row", { name: "Personal" }).click();
  await dialog.getByRole("textbox").first().fill(base);
  await dialog
    .getByRole("button", { name: /create/i })
    .last()
    .click();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await appendToActiveDocBody(page, token);
  await page.waitForTimeout(2000);

  // Meanwhile another device creates the same name.
  await seedDocAtPath(`${HOME}/${base}.md`, "# server copy\n\nserver-token\n");
  await context.setOffline(false);

  await expect
    .poll(() => serverText(`${HOME}/${base} (1).md`), { timeout: 45_000 })
    .toContain(token);
  expect(await serverText(`${HOME}/${base}.md`)).toContain("server-token");
  expect(await serverText(`${HOME}/${base}.md`)).not.toContain(token);
  await expect.poll(() => editorShows(page), { timeout: 15_000 }).toContain(`${base} (1)`);
  expect(errors).toEqual([]);
});

test("gap 1: a reload while the offline create is still queued keeps both", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const base = `Gaps reload ${run()}`;
  const token = `offline-reload-${run()}`;
  await gotoDocsHome(page);
  await page.waitForTimeout(2000);
  await goOffline(context, page);

  await page.getByRole("button", { name: "New document" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("row", { name: "Personal" }).click();
  await dialog.getByRole("textbox").first().fill(base);
  await dialog
    .getByRole("button", { name: /create/i })
    .last()
    .click();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await appendToActiveDocBody(page, token);
  await page.waitForTimeout(2000);

  // Meanwhile another device creates the same name.
  await seedDocAtPath(`${HOME}/${base}.md`, "# server copy\n\nserver-token\n");

  // The flush's create fails, so the create is still queued when the tab reloads online.
  let createsRefused = 0;
  const refuseCreate = async (route: Route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("FileNode/set") && body.includes(base)) {
      createsRefused += 1;
      await route.fulfill({ status: 503, body: "unavailable" });
      return;
    }
    await route.fallback();
  };
  await page.route("**/jmap**", refuseCreate);
  await context.setOffline(false);
  await expect.poll(() => createsRefused, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.unroute("**/jmap**", refuseCreate);

  await expect
    .poll(() => serverText(`${HOME}/${base} (1).md`), { timeout: 60_000 })
    .toContain(token);
  expect(await serverText(`${HOME}/${base}.md`)).toContain("server-token");
  expect(await serverText(`${HOME}/${base}.md`)).not.toContain(token);
  await expect.poll(() => editorShows(page), { timeout: 15_000 }).toContain(`${base} (1)`);
  expect(errors).toEqual([]);
});

test("gap 2a: a rename in another tab offline takes the open editor and its text along", async ({
  context,
}) => {
  test.setTimeout(150_000);
  const id = run();
  const name = `Gaps tab ${id}.md`;
  const nextBase = `Gaps tab renamed ${id}`;
  const token = `tab-offline-${id}`;
  await seedDocAtPath(`${HOME}/${name}`, `# ${name}\n`);
  const editor = await context.newPage();
  const home = await context.newPage();
  const errors = [...watchErrors(editor), ...watchErrors(home)];
  await gotoDocsHome(home);
  await expect(docsHomeRow(home, name)).toBeVisible({ timeout: 30_000 });
  await openEditor(editor, `${HOME}/${name}`);
  // Opened online, the editor names the file by its id and keeps its text under that id.
  const nodeId = editorNodeId(editor);
  expect(nodeId).not.toBe("");

  await goOffline(context, editor);
  await appendToActiveDocBody(editor, token);
  await editor.waitForTimeout(1000);
  await renameFromRow(home, name, nextBase);
  // The editor follows while both tabs are still offline, on the same id.
  await expect.poll(() => editorShows(editor), { timeout: 10_000 }).toContain(nextBase);
  expect(editorNodeId(editor)).toBe(nodeId);
  await expect(editor.locator(".ProseMirror")).toContainText(token);

  await context.setOffline(false);
  await expect
    .poll(() => serverText(`${HOME}/${nextBase}.md`), { timeout: 45_000 })
    .toContain(token);
  // Nothing was saved back to the old name.
  await editor.waitForTimeout(3000);
  expect(await serverText(`${HOME}/${name}`)).toBeNull();
  expect(errors).toEqual([]);
});

test("gap 2b: a rename on another device while this one types offline keeps the text", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = run();
  const name = `Gaps device ${id}.md`;
  const nextBase = `Gaps device renamed ${id}`;
  const token = `device-offline-${id}`;
  await seedDocAtPath(`${HOME}/${name}`, `# ${name}\n`);
  const deviceA = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const deviceB = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  try {
    const editor = await deviceA.newPage();
    const home = await deviceB.newPage();
    const errors = [...watchErrors(editor), ...watchErrors(home)];
    await openEditor(editor, `${HOME}/${name}`);
    await goOffline(deviceA, editor);
    await appendToActiveDocBody(editor, token);
    await editor.waitForTimeout(1000);

    await gotoDocsHome(home);
    await renameFromRow(home, name, nextBase);
    await expect.poll(() => serverText(`${HOME}/${nextBase}.md`)).not.toBeNull();

    await deviceA.setOffline(false);
    await expect.poll(() => editorShows(editor), { timeout: 30_000 }).toContain(nextBase);
    await expect
      .poll(() => serverText(`${HOME}/${nextBase}.md`), { timeout: 45_000 })
      .toContain(token);
    await editor.waitForTimeout(3000);
    expect(await serverText(`${HOME}/${name}`)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});

test("gap 3: Starred and Trash work offline, and what needs a connection says so", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const id = run();
  const star = `Gaps star ${id}.md`;
  const unstar = `Gaps unstar ${id}.md`;
  const trash = `Gaps trash ${id}.md`;
  const keep = `Gaps keep trashed ${id}.md`;
  for (const name of [star, unstar, trash, keep])
    await seedDocAtPath(`${HOME}/${name}`, `# ${name}\n`);
  await gotoDocsHome(page);
  await expect(docsHomeRow(page, keep)).toBeVisible({ timeout: 30_000 });
  // Online first: one starred Doc, one trashed Doc, and both views cached once.
  await (await openRowMenu(page, unstar)).getByRole("menuitem", { name: "Star" }).click();
  await (await openRowMenu(page, keep)).getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
  await undoWindowsClosed(page);
  await expect(docsHomeRow(page, keep)).toHaveCount(0);
  await sidebarView(page, "Starred").click();
  await expect(docsHomeRow(page, unstar)).toBeVisible({ timeout: 15_000 });
  await sidebarView(page, "Trash").click();
  await expect(docsHomeRow(page, keep)).toBeVisible({ timeout: 15_000 });
  await sidebarView(page, "My Docs").click();
  await expect(docsHomeRow(page, star)).toBeVisible({ timeout: 15_000 });

  await goOffline(context, page);
  await (await openRowMenu(page, star)).getByRole("menuitem", { name: "Star" }).click();
  await (await openRowMenu(page, trash)).getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
  await undoWindowsClosed(page);
  await expect(docsHomeRow(page, trash)).toHaveCount(0);

  await sidebarView(page, "Starred").click();
  await expect(docsHomeRow(page, star)).toBeVisible({ timeout: 15_000 });
  await expect(docsHomeRow(page, unstar)).toBeVisible();
  await (await openRowMenu(page, unstar)).getByRole("menuitem", { name: "Unstar" }).click();
  await undoWindowsClosed(page);
  await expect(docsHomeRow(page, unstar)).toHaveCount(0, { timeout: 10_000 });

  await sidebarView(page, "Trash").click();
  await expect(docsHomeRow(page, trash)).toBeVisible({ timeout: 15_000 });
  await expect(docsHomeRow(page, keep)).toBeVisible();
  // Restore: move the Doc out of Trash, back to Personal.
  await (await openRowMenu(page, trash)).getByRole("menuitem", { name: "Move" }).click();
  const move = page.getByRole("dialog", { name: "Move to folder" });
  await move.getByRole("button", { name: "Move here" }).click();
  await expect(move).toBeHidden();
  await undoWindowsClosed(page);
  await expect(docsHomeRow(page, trash)).toHaveCount(0, { timeout: 10_000 });
  // Permanent delete needs the server, and says so.
  await (
    await openRowMenu(page, keep)
  )
    .getByRole("menuitem", { name: "Delete permanently" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleting permanently needs a connection.")).toBeVisible();
  await expect(docsHomeRow(page, keep)).toBeVisible();

  await sidebarView(page, "Shared with me").click();
  await expect(page.getByText("Shared documents are not available offline.")).toBeVisible({
    timeout: 15_000,
  });
  await sidebarView(page, "My Docs").click();
  await expect(docsHomeRow(page, trash)).toBeVisible({ timeout: 15_000 });

  await context.setOffline(false);
  await expect.poll(() => serverText(`${HOME}/${trash}`), { timeout: 45_000 }).not.toBeNull();
  expect(await serverText(`${HOME}/.Trash/${keep}`)).not.toBeNull();
  await sidebarView(page, "Starred").click();
  await expect(docsHomeRow(page, star)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await sidebarView(page, "Starred").click();
  await expect(docsHomeRow(page, star)).toBeVisible({ timeout: 30_000 });
  await expect(docsHomeRow(page, unstar)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("gap 4: Changes synced only shows once the changes reached the server", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await recordToasts(page);
  const id = run();
  const name = `Gaps toast ${id}.md`;
  const flap = `Gaps toast flap ${id}.md`;
  for (const file of [name, flap]) await seedDocAtPath(`${HOME}/${file}`, `# ${file}\n`);
  await gotoDocsHome(page);
  await expect(docsHomeRow(page, flap)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);

  // A reconnect with nothing queued syncs nothing.
  await goOffline(context, page);
  await context.setOffline(false);
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5000);
  expect(await toasts(page, "Changes synced")).toEqual([]);

  // A queued rename that lands says so, online.
  await goOffline(context, page);
  await renameFromRow(page, name, `Gaps toast renamed ${id}`);
  await context.setOffline(false);
  await expect
    .poll(() => serverText(`${HOME}/Gaps toast renamed ${id}.md`), { timeout: 45_000 })
    .not.toBeNull();
  await expect.poll(async () => (await toasts(page, "Changes synced")).length).toBe(1);
  await expect(page.locator("[data-sonner-toast]", { hasText: "Changes synced" })).toHaveCount(0, {
    timeout: 20_000,
  });

  // A flapping network: back online for a moment, then offline again. Whether
  // or not the rename landed in that moment, no toast shows while offline.
  await goOffline(context, page);
  await renameFromRow(page, flap, `Gaps toast flap renamed ${id}`);
  await context.setOffline(false);
  await page.waitForTimeout(150);
  await context.setOffline(true);
  await page.waitForTimeout(8000);
  await context.setOffline(false);
  await expect
    .poll(() => serverText(`${HOME}/Gaps toast flap renamed ${id}.md`), { timeout: 45_000 })
    .not.toBeNull();
  await page.waitForTimeout(3000);
  expect((await toasts(page, "Changes synced")).filter((toast) => !toast.online)).toEqual([]);
  expect(errors).toEqual([]);
});

test("gap 5: Docs home offline shows no Failed to fetch and throws nothing", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  const name = `Gaps sweep ${run()}.md`;
  await seedDocAtPath(`${HOME}/${name}`, `# ${name}\n`);
  await gotoDocsHome(page);
  await expect(docsHomeRow(page, name)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await goOffline(context, page);

  const failedToFetch = page.getByText("Failed to fetch");
  for (const view of ["Shared with me", "Recent", "Starred", "Trash", "Personal", "My Docs"]) {
    await sidebarView(page, view).click();
    await page.waitForTimeout(2000);
    await expect(failedToFetch, view).toHaveCount(0);
  }
  for (const item of ["Move", "Share"]) {
    await (await openRowMenu(page, name)).getByRole("menuitem", { name: item }).click();
    await page.waitForTimeout(2000);
    await expect(failedToFetch, item).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "New document" }).first().click();
  await page.waitForTimeout(2000);
  await expect(failedToFetch, "New document").toHaveCount(0);
  await page.keyboard.press("Escape");
  await docsHomeRow(page, name).dblclick();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(failedToFetch, "editor").toHaveCount(0);

  await context.setOffline(false);
  await page.waitForTimeout(5000);
  expect(errors).toEqual([]);
});
