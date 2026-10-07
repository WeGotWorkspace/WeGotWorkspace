import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERNAME } from "./notes-live";

export { E2E_PASSWORD, E2E_USERNAME };

export function myDriveDocSearchPath(fileName: string): string {
  return `users/${E2E_USERNAME}/${fileName}`;
}

export function docsUrlForFile(apiPath: string): string {
  const normalized = apiPath.replace(/^\/+/, "");
  return `/docs?file=${encodeURIComponent(normalized)}`;
}

export async function loginToDocs(page: Page, fileSearchPath?: string): Promise<void> {
  const target = fileSearchPath ? docsUrlForFile(`/${fileSearchPath}`) : "/docs";
  await page.goto(target);
  if (fileSearchPath) {
    await expect(page.locator(".ProseMirror, .docs-workspace__empty")).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await expect(page.locator(".docs-workspace")).toBeVisible({ timeout: 30_000 });
  }
  await expect(
    page.getByRole("status", { name: /Offline — changes sync when reconnected/i }),
  ).toHaveCount(0);
}

/** Navigate to the Docs home (no `file` param) and wait for the browse list shell. */
export async function gotoDocsHome(page: Page): Promise<void> {
  await page.goto("/docs");
  await expect(page.locator(".docs-home-pane")).toBeVisible({ timeout: 30_000 });
}

/** List-view row for a Docs home file, matched by its (unique) file name. */
export function docsHomeRow(page: Page, fileName: string) {
  return page.locator(".drive-list-row", { hasText: fileName });
}

/**
 * Wait until auto-sync has cached the document body offline.
 * Rows show an amber badge while syncing; once done there is no badge (green "available" is not shown).
 */
export async function waitForDocsBodySynced(
  page: Page,
  fileName: string,
  apiPath?: string,
): Promise<void> {
  const row = docsHomeRow(page, fileName);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const normalizedPath = (apiPath ?? `/${myDriveDocSearchPath(fileName)}`).replace(/^\/+/, "");

  await expect
    .poll(
      async () => {
        const badge = row.locator(".drive-offline-badge");
        if ((await badge.count()) > 0) {
          const label = (await badge.first().getAttribute("aria-label")) ?? "";
          if (label === "Syncing offline" || label === "Pending sync") return false;
        }
        return page.evaluate(async (path) => {
          const username = localStorage.getItem("wgw.offline.docs.username");
          if (!username) return false;
          const dbName = `wgw-offline-${username}`;
          return new Promise<boolean>((resolve) => {
            const request = indexedDB.open(dbName);
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("docs_availability")) {
                resolve(false);
                return;
              }
              const tx = db.transaction("docs_availability", "readonly");
              const get = tx.objectStore("docs_availability").get(path);
              get.onsuccess = () => resolve(Boolean(get.result));
              get.onerror = () => resolve(false);
            };
          });
        }, normalizedPath);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** Drop the docs offline IndexedDB so e2e starts from a clean cache. */
export async function clearDocsOfflineStore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const username = localStorage.getItem("wgw.offline.docs.username");
    const dbName = username ? `wgw-offline-${username}` : undefined;
    if (!dbName) return;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onerror = () => reject(request.error ?? new Error("deleteDatabase failed"));
      request.onblocked = () => resolve();
      request.onsuccess = () => resolve();
    });
  });
}

function parentPath(apiPath: string): string {
  const normalized = apiPath.replace(/^\/+/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? `/${normalized.slice(0, slash)}` : "/";
}

function fileName(apiPath: string): string {
  const normalized = apiPath.replace(/^\/+/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function mimeForFile(file: string): { uploadMime: string; fileMime: string } {
  const lower = file.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".log")) {
    return { uploadMime: "text/plain;charset=utf-8", fileMime: "text/plain" };
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return { uploadMime: "application/yaml;charset=utf-8", fileMime: "application/yaml" };
  }
  return { uploadMime: "text/markdown;charset=utf-8", fileMime: "text/markdown" };
}

export async function saveCollabDocument(
  page: Page,
  apiPath: string,
  markdown: string,
  yjs: number[],
): Promise<void> {
  const path = apiPath.replace(/^\/+/, "");
  await page.evaluate(
    async ({ collabPath, body, sidecar }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch(
        `/api/v1/files/collaboration?path=${encodeURIComponent(collabPath)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ markdown: body, yjs: sidecar, room: collabPath }),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`saveCollabDocument failed (${response.status}): ${text}`);
      }
    },
    { collabPath: path, body: markdown, sidecar: yjs },
  );
}

export async function seedDocAtPath(page: Page, apiPath: string, content: string): Promise<void> {
  const destination = parentPath(apiPath);
  const name = fileName(apiPath);
  const { uploadMime, fileMime } = mimeForFile(name);
  await page.evaluate(
    async ({ cwd, fileName, body, uploadMimeType, fileMimeType }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const blob = new Blob([body], { type: uploadMimeType });
      const file = new File([blob], fileName, {
        type: fileMimeType,
        lastModified: Date.now(),
      });
      const form = new FormData();
      form.append("file", file, fileName);
      form.append("resumableFilename", fileName);
      form.append("resumableIdentifier", `${fileName}-${Date.now()}`);
      form.append("resumableChunkNumber", "1");
      form.append("resumableTotalChunks", "1");
      const response = await fetch(`/api/v1/files/content?path=${encodeURIComponent(cwd)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!response.ok) throw new Error(`Seed doc failed (${response.status})`);
    },
    {
      cwd: destination,
      fileName: name,
      body: content,
      uploadMimeType: uploadMime,
      fileMimeType: fileMime,
    },
  );
}

export async function prepareDocsForOfflineSync(page: Page, fileName: string): Promise<string> {
  const searchPath = myDriveDocSearchPath(fileName);
  await loginToDocs(page);
  await clearDocsOfflineStore(page);
  await seedDocAtPath(page, `/${searchPath}`, "# E2E seed\n");
  await page.goto(docsUrlForFile(`/${searchPath}`));
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("status", { name: /Offline — changes sync when reconnected/i }),
  ).toHaveCount(0);
  return `/${searchPath}`;
}

export async function prepareGroupDocForOfflineSync(page: Page, apiPath: string): Promise<string> {
  await loginToDocs(page);
  await clearDocsOfflineStore(page);
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("status", { name: /Offline — changes sync when reconnected/i }),
  ).toHaveCount(0);
  return apiPath;
}

export async function currentEditorText(page: Page): Promise<string> {
  return page.locator(".ProseMirror").innerText();
}

export async function expectOfflineIndicator(page: Page): Promise<void> {
  await expect(page.getByText(/Offline — changes sync when reconnected/i)).toBeVisible({
    timeout: 15_000,
  });
}

export async function appendToActiveDocBody(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(text, { delay: 20 });
}

export async function expectPendingDotVisible(page: Page): Promise<void> {
  await expect(page.getByRole("status", { name: "Unsaved changes" })).toBeVisible({
    timeout: 10_000,
  });
}

export async function expectPendingDotHidden(page: Page): Promise<void> {
  await expect(page.getByRole("status", { name: "Unsaved changes" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("status", { name: "Save failed — changes not on server" }),
  ).toHaveCount(0, { timeout: 20_000 });
}

export async function expectSyncCompleted(page: Page): Promise<void> {
  await expect(page.getByText("Changes synced")).toBeVisible({ timeout: 20_000 });
  await expectPendingDotHidden(page);
}

/** Block API + same-origin reachability probe (DevTools SW offline shape). Call after an initial online login. */
export async function blockReachabilityAndApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "HEAD" && url.pathname === "/") {
      return route.abort("failed");
    }
    if (url.pathname.includes("/api/v1/")) {
      return route.abort("failed");
    }
    return route.continue();
  });
}

export async function reloadDocsOffline(page: Page, apiPath: string): Promise<void> {
  await page.goto(docsUrlForFile(apiPath));
  await expect(
    page
      .locator(".ProseMirror")
      .or(page.locator(".docs-workspace__error"))
      .or(page.getByText("Could not load docs")),
  ).toBeVisible({
    timeout: 30_000,
  });
}

export async function restoreNetwork(page: Page): Promise<void> {
  await page.unroute("**/*");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
}

export async function waitForDocSaved(page: Page, apiPath: string, token: string): Promise<void> {
  await expect.poll(() => docTokenOnServer(page, apiPath, token), { timeout: 30_000 }).toBe(true);
}

export async function expectEditorContains(page: Page, token: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((expected) => document.body.textContent?.includes(expected) ?? false, token),
      { timeout: 30_000 },
    )
    .toBe(true);
}

export async function docTokenOnServer(
  page: Page,
  apiPath: string,
  token: string,
): Promise<boolean> {
  return page.evaluate(
    async ({ path, expected }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const response = await fetch(`/api/v1/files/content?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return false;
      const text = await response.text();
      return text.includes(expected);
    },
    { path: apiPath, expected: token },
  );
}
