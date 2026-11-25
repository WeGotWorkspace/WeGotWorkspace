// Settings › Offline › Clear cache (live app).
//
// Clear cache drops the file contents background sync saved by itself. Files
// the user made available offline, and files with a change not sent yet, keep
// their copy: offline Drive must still open them. The listing keeps every
// name. Turning content sync off keeps the saved files until Clear cache runs;
// after both, sync stays off and the pinned copy stays.
import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";
import {
  API,
  goOfflineKeepingShell,
  goOnlineAgain,
  installOnlineFlag,
  namesIn,
} from "./helpers/drive-upload-live";

const RUN = Date.now().toString(36);
/** 1×1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const basicAuth = `Basic ${Buffer.from(`${E2E_USERNAME}:${E2E_PASSWORD}`).toString("base64")}`;

/** Images, not text: text files are Docs documents, whose copy is never cleared. */
type Files = { folder: string; auto: string; pinned: string; renamed: string; renamedTo: string };

function filesFor(label: string): Files {
  return {
    folder: `Clear cache ${label} ${RUN}`,
    auto: `auto-${RUN}.png`,
    pinned: `pinned-${RUN}.png`,
    renamed: `renamed-${RUN}.png`,
    renamedTo: `renamed-new-${RUN}.png`,
  };
}

async function dav(method: string, path: string, body?: Uint8Array<ArrayBuffer>): Promise<void> {
  const res = await fetch(`${API}/files/users/${E2E_USERNAME}/${path}`, {
    method,
    headers: { Authorization: basicAuth, "Content-Type": "image/png" },
    body,
  });
  const fine = res.ok || (method === "DELETE" && res.status === 404);
  if (!fine) throw new Error(`${method} ${path} failed: ${res.status}`);
}

async function seed(files: Files): Promise<void> {
  const folder = encodeURIComponent(files.folder);
  await dav("MKCOL", `${folder}/`);
  for (const name of [files.auto, files.pinned, files.renamed]) {
    await dav("PUT", `${folder}/${encodeURIComponent(name)}`, PNG);
  }
}

function folderUrl(files: Files): string {
  return `/drive?view=folder&path=${encodeURIComponent(`My Drive/${files.folder}`)}`;
}

/** Starts with content sync off, so the pin below is the user's own and not the sync's. */
async function prepare(context: BrowserContext): Promise<void> {
  await installOnlineFlag(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("wgw.offline.deviceContentSettings")) {
      localStorage.setItem(
        "wgw.offline.deviceContentSettings",
        JSON.stringify({ contentSyncEnabled: false, maxFileSizeBytes: 8 * 1024 * 1024 }),
      );
    }
  });
}

type Copy = { name: string; source: string | null; content: boolean };

/** The offline copy of each file in the folder: availability row and stored contents. */
async function copies(page: Page, folder: string): Promise<Copy[]> {
  return page.evaluate(async (name) => {
    const byName = new Map<string, { source: string | null; content: boolean }>();
    const inFolder = (id: string) => {
      const at = id.indexOf(`/${name}/`);
      return at < 0 ? null : id.slice(at + name.length + 2);
    };
    const readAll = (db: IDBDatabase, store: string) =>
      new Promise<Array<{ id: string; source?: string }>>((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const get = db.transaction(store, "readonly").objectStore(store).getAll();
        get.onsuccess = () => resolve(get.result as never);
        get.onerror = () => resolve([]);
      });
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      for (const row of await readAll(db, "drive_availability")) {
        const file = inFolder(row.id);
        if (file) byName.set(file, { source: row.source ?? null, content: false });
      }
      for (const row of await readAll(db, "drive_content_blobs")) {
        const file = inFolder(row.id);
        if (file) byName.set(file, { source: byName.get(file)?.source ?? null, content: true });
      }
      db.close();
    }
    return [...byName].map(([file, copy]) => ({ name: file, ...copy })).sort();
  }, folder);
}

async function copyOf(page: Page, folder: string, name: string): Promise<Copy | null> {
  return (await copies(page, folder)).find((copy) => copy.name === name) ?? null;
}

function row(page: Page, name: string) {
  return page
    .getByText(name, { exact: true })
    .first()
    .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
}

async function openFile(page: Page, name: string): Promise<void> {
  await row(page, name).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Open" }).click();
}

/** The preview shows the image (served from the offline copy). */
async function expectImageOpens(page: Page, name: string): Promise<void> {
  await openFile(page, name);
  await expect(page.getByRole("img", { name }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("This file is not available offline.")).toHaveCount(0);
  await page.keyboard.press("Escape");
}

async function pin(page: Page, files: Files): Promise<void> {
  await row(page, files.pinned).getByRole("button", { name: "Make available offline" }).click();
  await expect
    .poll(() => copyOf(page, files.folder, files.pinned), { timeout: 30_000 })
    .toMatchObject({ source: "manual", content: true });
}

/**
 * Opens Settings › Offline and waits until the page stops re-mounting: the
 * workspace renders at once and mounts again when its bootstrap lands, which
 * would drop a dialog opened in between.
 */
async function openOfflineSettings(page: Page): Promise<void> {
  await page.goto("/settings/offline");
  const toggle = page.getByRole("button", { name: /^Turn (on|off)$/ });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    const find = () =>
      [...document.querySelectorAll("button")].find((b) =>
        /^Turn (on|off)$/.test(b.textContent ?? ""),
      );
    let last = find();
    let stableSince = Date.now();
    const started = Date.now();
    while (Date.now() - stableSince < 1_000 && Date.now() - started < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const now = find();
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      }
    }
  });
}

/** Turns content sync on in Settings and waits until the sync has saved the other two files. */
async function syncAutomatically(page: Page, files: Files): Promise<void> {
  await openOfflineSettings(page);
  await expect(page.getByRole("button", { name: "Turn on", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(page.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
  await page.goto(folderUrl(files));
  await expect(page.getByText(files.auto, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  for (const name of [files.auto, files.renamed]) {
    await expect
      .poll(() => copyOf(page, files.folder, name), { timeout: 60_000, intervals: [500] })
      .toMatchObject({ source: "auto", content: true });
  }
}

/** Drive changes waiting in the offline outbox (read straight from IndexedDB). */
async function queuedDriveOps(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const ops: string[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      if (db.objectStoreNames.contains("outbox")) {
        const rows = await new Promise<Array<{ domain?: string; op?: string }>>((resolve) => {
          const get = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
          get.onsuccess = () => resolve(get.result as never);
          get.onerror = () => resolve([]);
        });
        for (const row of rows) if (row.domain === "drive" && row.op) ops.push(row.op);
      }
      db.close();
    }
    return ops;
  });
}

/**
 * Back online for everything except Drive writes, so the rename stays in the
 * outbox. Settings needs the network to load (it has no offline copy).
 */
async function goOnlineHoldingDriveWrites(page: Page): Promise<void> {
  await page
    .context()
    .route("**/api/v1/jmap", (route) =>
      (route.request().postData() ?? "").includes("FileNode/set")
        ? route.abort("internetdisconnected")
        : route.fallback(),
    );
  await page.context().unroute("**/*");
  await page.evaluate(() => {
    sessionStorage.removeItem("e2e-offline");
    window.dispatchEvent(new Event("online"));
  });
}

async function renameOffline(page: Page, from: string, to: string): Promise<void> {
  await row(page, from).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename item" });
  const field = dialog.getByRole("textbox");
  // The extension may sit outside the field ("File extensions cannot be changed").
  const current = await field.inputValue();
  await field.fill(current.endsWith(".png") ? to : to.replace(/\.png$/, ""));
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText(to, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("Settings › Offline › Clear cache (live app)", () => {
  const clear = filesFor("clear");
  const turnOff = filesFor("off");

  test.beforeAll(async () => {
    await seed(clear);
    await seed(turnOff);
  });

  test.afterAll(async () => {
    await dav("DELETE", `${encodeURIComponent(clear.folder)}/`);
    await dav("DELETE", `${encodeURIComponent(turnOff.folder)}/`);
  });

  test("Clear cache drops only the automatic copy; pinned and unsent files still open offline", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await prepare(context);

    // 1. A pinned file, then content sync saves the other two by itself.
    await page.goto(folderUrl(clear));
    await expect(page.getByText(clear.pinned, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await pin(page, clear);
    await syncAutomatically(page, clear);

    // 2. Offline, a rename waits in the outbox.
    await goOfflineKeepingShell(page);
    await renameOffline(page, clear.renamed, clear.renamedTo);
    // The new name shows before the change is written to the outbox.
    await expect.poll(() => queuedDriveOps(page), { timeout: 15_000 }).toContain("rename");

    // 3. Settings › Offline in the same tab: Clear cache removes one copy. Settings
    //    needs the network to load, so only Drive writes stay blocked: the rename waits.
    await goOnlineHoldingDriveWrites(page);
    await openOfflineSettings(page);
    await page.getByRole("button", { name: "Clear cache" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Clear cache?" });
    await confirm.getByRole("button", { name: "Clear cache" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toHaveText(
      /Cleared \d+ offline files?/,
      {
        timeout: 15_000,
      },
    );

    const left = await copies(page, clear.folder);
    expect(left.find((copy) => copy.name === clear.auto)).toBeUndefined();
    expect(left.find((copy) => copy.name === clear.pinned)).toMatchObject({ content: true });
    expect(
      left.some(
        (copy) => (copy.name === clear.renamed || copy.name === clear.renamedTo) && copy.content,
      ),
      "the renamed file keeps its copy while the rename is not sent",
    ).toBe(true);

    expect(await namesIn(page, clear.folder), "the rename is still waiting").toContain(
      clear.renamed,
    );

    // 4. Offline again, a reload of Drive: names stay, the kept copies open.
    await page.context().unrouteAll({ behavior: "ignoreErrors" });
    await goOfflineKeepingShell(page);
    await page.goto(folderUrl(clear));
    await expect(page.getByText(clear.auto, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expectImageOpens(page, clear.pinned);
    await expectImageOpens(page, clear.renamedTo);
    await openFile(page, clear.auto);
    await expect(page.getByText("This file is not available offline.").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");

    // 5. Online again, the rename reaches the server.
    await goOnlineAgain(page);
    await expect
      .poll(() => namesIn(page, clear.folder), { timeout: 60_000, intervals: [1_000] })
      .toEqual(expect.arrayContaining([clear.renamedTo]));
    expect(await namesIn(page, clear.folder)).not.toContain(clear.renamed);
  });

  test("Turn off, then Clear cache keeps sync off and the pinned copy", async ({
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    await prepare(context);

    await page.goto(folderUrl(turnOff));
    await expect(page.getByText(turnOff.pinned, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await pin(page, turnOff);
    await syncAutomatically(page, turnOff);

    await openOfflineSettings(page);
    await page.getByRole("button", { name: "Turn off", exact: true }).click();
    const ask = page.getByRole("alertdialog", { name: "Turn off offline file contents?" });
    await ask.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(ask).toBeHidden();
    await page.getByRole("button", { name: "Clear cache", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Clear cache?" });
    await confirm.getByRole("button", { name: "Clear cache", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toHaveText(
      /Cleared \d+ offline files?/,
      { timeout: 15_000 },
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Turn on", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const left = await copies(page, turnOff.folder);
    expect(left.find((copy) => copy.name === turnOff.auto)).toBeUndefined();
    expect(left.find((copy) => copy.name === turnOff.renamed)).toBeUndefined();
    expect(left.find((copy) => copy.name === turnOff.pinned)).toMatchObject({
      source: "manual",
      content: true,
    });
  });
});
