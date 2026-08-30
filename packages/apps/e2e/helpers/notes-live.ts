import { expect, type Page } from "@playwright/test";

export const E2E_USERNAME = process.env.WGW_E2E_USERNAME ?? "admin";
export const E2E_PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

export async function loginToNotes(page: Page): Promise<void> {
  await page.goto("/notes");
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible({ timeout: 30_000 });
  await waitForNotesListReady(page);
  await expect(
    page.getByRole("status", { name: /Offline — changes sync when reconnected/i }),
  ).toHaveCount(0);
}

/** Drop the notes offline IndexedDB so e2e starts from server bootstrap (avoids stale local-* ids). */
export async function clearNotesOfflineStore(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const username = localStorage.getItem("wgw.offline.notes.username");
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

export async function prepareNotesForOfflineSync(page: Page): Promise<void> {
  await loginToNotes(page);
  await clearNotesOfflineStore(page);
  await page.reload();
  await loginToNotes(page);
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await waitForNotesListReady(page);
  if ((await page.locator(".list-item__button").count()) === 0) {
    await seedNoteWithToken(page, `e2e-seed-${Date.now()}`);
  }
}

export async function waitForNotesListReady(page: Page): Promise<void> {
  await expect(page.getByLabel("Loading notes…")).toHaveCount(0, { timeout: 30_000 });
  const refresh = page.getByRole("button", { name: "Refresh notes" });
  if ((await refresh.count()) > 0) {
    await expect(refresh).toBeEnabled({ timeout: 30_000 });
  }
}

export async function expectOfflineIndicator(page: Page): Promise<void> {
  await expect(page.getByText(/Offline — changes sync when reconnected/i)).toBeVisible({
    timeout: 15_000,
  });
}

export async function openFirstNote(page: Page): Promise<void> {
  await waitForNotesListReady(page);
  const firstNote = page.locator(".list-item__button").first();
  await expect(firstNote).toBeVisible({ timeout: 15_000 });
  await firstNote.click();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15_000 });
}

export async function appendToActiveNoteBody(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(text, { delay: 20 });
}

export async function expectPendingDotVisible(page: Page): Promise<void> {
  await expect(page.getByRole("img", { name: "Pending sync" })).toBeVisible({ timeout: 10_000 });
}

export async function expectPendingDotHidden(page: Page): Promise<void> {
  await expect(page.getByRole("img", { name: "Pending sync" })).toHaveCount(0, { timeout: 20_000 });
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

export async function reloadNotesOffline(page: Page): Promise<void> {
  await page.goto("/notes");
  await waitForNotesListReady(page);
}

export async function restoreNetwork(page: Page): Promise<void> {
  await page.unroute("**/*");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
}

export async function waitForNoteSaved(page: Page, token: string): Promise<void> {
  await expect.poll(() => noteTokenOnServer(page, token), { timeout: 30_000 }).toBe(true);
}

export async function markActiveNoteWithToken(page: Page, token: string): Promise<void> {
  await openFirstNote(page);
  await appendToActiveNoteBody(page, token);
  await waitForNoteSaved(page, token);
}

/** Create an isolated note for destructive e2e flows (avoids wiping shared seed notes). */
export async function seedNoteWithToken(page: Page, token: string): Promise<void> {
  await page.evaluate(async (bodyToken) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const response = await fetch("/api/v1/notes/items", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        notebook: "Drafts",
        title: `E2E ${bodyToken}`,
        body: bodyToken,
        tags: [],
      }),
    });
    if (!response.ok) throw new Error(`Seed note failed (${response.status})`);
  }, token);
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await waitForNotesListReady(page);
}

export async function archiveActiveNote(page: Page): Promise<void> {
  const archiveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/notes/items") &&
      response.request().method() === "PATCH" &&
      response.ok(),
    { timeout: 35_000 },
  );

  const archiveButton = page
    .locator(".action-bar__right")
    .getByRole("button", { name: "Archive", exact: true });
  if (await archiveButton.isVisible()) {
    await archiveButton.click();
  } else {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.locator(".dropdown-menu__content").getByRole("button", { name: "Archive" }).click();
  }

  await archiveResponse;
}

export async function archiveNoteTokenOnServer(page: Page, token: string): Promise<void> {
  await page.evaluate(async (expected) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const listResponse = await fetch("/api/v1/notes/items", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listResponse.ok) throw new Error("Failed to list notes for archive helper");
    const json = (await listResponse.json()) as {
      items?: { id?: string; body?: string; title?: string; excerpt?: string }[];
    };
    const item = json.items?.find((row) => {
      const haystack = [row.body, row.title, row.excerpt].filter(Boolean).join(" ");
      return haystack.includes(expected);
    });
    if (!item?.id) throw new Error(`Note with token ${expected} not found on server`);

    const patchResponse = await fetch(`/api/v1/notes/items/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    if (!patchResponse.ok) throw new Error(`Archive PATCH failed (${patchResponse.status})`);
  }, token);
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await waitForNotesListReady(page);
}

export async function openArchiveView(page: Page, token?: string): Promise<void> {
  await page.getByRole("button", { name: "Archived" }).click();
  await waitForNotesListReady(page);
  if (!token) return;
  await page.getByPlaceholder("Search notes...").fill(token);
  await expect
    .poll(async () => page.locator(".list-item__button").filter({ hasText: token }).count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

export async function deleteFilteredArchivedNotes(page: Page, searchToken: string): Promise<void> {
  await openArchiveView(page, searchToken);

  await page.getByRole("button", { name: "Empty archive" }).click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect.poll(() => noteTokenOnServer(page, searchToken), { timeout: 45_000 }).toBe(false);
}

export async function noteTokenOnServer(page: Page, token: string): Promise<boolean> {
  return page.evaluate(async (expected) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const response = await fetch("/api/v1/notes/items", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return false;
    const json = (await response.json()) as {
      items?: { body?: string; title?: string; excerpt?: string }[];
    };
    return (
      json.items?.some((item) => {
        const haystack = [item.body, item.title, item.excerpt].filter(Boolean).join(" ");
        return haystack.includes(expected);
      }) ?? false
    );
  }, token);
}
