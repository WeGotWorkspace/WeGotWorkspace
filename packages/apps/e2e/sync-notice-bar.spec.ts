// The "could not sync" row in each app's notice bar (#1895), on the live app.
//
// Notes, Contacts, Calendar, Drive and Docs home: a change queued offline
// whose write then fails at the network (held on the whole browser context, the
// way a flaky connection fails it) shows the row with an enabled action, in the
// notice bar and not as a toast. Retry while the write still fails keeps the
// row, and a reload keeps it too: it reads the outbox. Once the write can land,
// Retry clears the row and the server has the change. Calendar also checks a
// second tab, which reads the same outbox.
//
// The Docs document view is different: its row follows the collab save, which
// is in memory only. A save that fails while online shows the row; once the
// save can land, Retry saves and the row goes away (same page load).
import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import {
  countCalendarEventsByTitleViaApi,
  createOfflineWeekEvent,
  deleteCalendarEventsByTitleViaApi,
  expectCalendarOffline,
  openCalendarWeek,
} from "./helpers/calendar-live";
import {
  appendToActiveDocBody,
  docsHomeRow,
  docsUrlForFile,
  docTokenOnServer,
  gotoDocsHome,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";
import { deleteDriveFile, putDriveFile } from "./helpers/drive-seed";
import { api, OWNER } from "./helpers/live-matrix";
import { waitForNotesListReady } from "./helpers/notes-live";
import { holdRequests, SYNC_FAILED, SYNC_FAILED_FILES, syncNoticeRow } from "./helpers/sync-notice";

const RUN = Date.now().toString(36);
/** Long enough for the reconnect flush and the 4 s failed-row poll. */
const SHOWS = { timeout: 60_000 };

/** The row is in the notice bar with an enabled action, and no toast says the same. */
async function expectRow(tab: Page, text: string, action: string): Promise<void> {
  const row = syncNoticeRow(tab, text);
  await expect(row, "the failed write shows the row").toBeVisible(SHOWS);
  await expect(row.getByRole("button", { name: action })).toBeEnabled();
  await expect(tab.locator("[data-sonner-toast]", { hasText: text })).toHaveCount(0);
}

/** The row's bar sits in this app's own slot (the list column, the Docs home pane). */
async function expectInSlot(tab: Page, slot: string): Promise<void> {
  const row = tab.locator(slot).locator(".notice-bar .notice-bar__notice");
  await expect(row.filter({ hasText: "could not sync" })).toHaveCount(1);
}

/** Retry while the write still fails: the action comes back and the row stays. */
async function retryWhileHeld(tab: Page, text: string, action: string): Promise<void> {
  const row = syncNoticeRow(tab, text);
  await row.getByRole("button", { name: action }).click();
  await expect(row.getByRole("button", { name: action })).toBeEnabled(SHOWS);
  await expect(row, "Retry while still held keeps the row").toBeVisible();
}

/** Retry once the write can land: the row goes away. */
async function retryClears(tab: Page, text: string, action: string): Promise<void> {
  const row = syncNoticeRow(tab, text);
  await row.getByRole("button", { name: action }).click();
  await expect(row, "a landed retry clears the row").toHaveCount(0, SHOWS);
}

/** Star and trash run once their Undo toast closes; wait for that. */
async function undoWindowsClosed(page: Page): Promise<void> {
  await expect(page.locator("[data-sonner-toast]", { hasText: "Undo" })).toHaveCount(0, {
    timeout: 20_000,
  });
}

// --- Notes ----------------------------------------------------------------------------------------

async function serverNoteIds(): Promise<Set<string>> {
  const notebooks = await api(OWNER, "GET", "/notes/notebooks");
  const ids = new Set<string>();
  for (const { id } of (notebooks.json as { list?: { id: string }[] }).list ?? []) {
    const res = await api(OWNER, "GET", `/notes/items?notebookId=${encodeURIComponent(id)}`);
    for (const note of (res.json as { list?: { id: string }[] }).list ?? []) ids.add(note.id);
  }
  return ids;
}

test("Notes: a new note that cannot sync shows Retry above the list until it lands", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const before = await serverNoteIds();
  const added: string[] = [];
  try {
    await page.goto("/notes");
    await waitForNotesListReady(page);
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator('[data-connectivity="offline"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForTimeout(1_500);

    const release = await holdRequests(context, {
      method: "POST",
      url: /\/api\/v1\/notes\/items(?:\?|$)/,
    });
    await context.setOffline(false);
    await expectRow(page, SYNC_FAILED, "Retry");
    await expectInSlot(page, ".collection-list-body");
    await retryWhileHeld(page, SYNC_FAILED, "Retry");

    await page.reload();
    await waitForNotesListReady(page);
    await expectRow(page, SYNC_FAILED, "Retry");
    expect((await serverNoteIds()).size, "nothing landed while held").toBe(before.size);

    await release();
    await retryClears(page, SYNC_FAILED, "Retry");
    await expect
      .poll(async () => [...(await serverNoteIds())].filter((id) => !before.has(id)).length, {
        message: "the server has the new note",
        timeout: 30_000,
      })
      .toBe(1);
    added.push(...[...(await serverNoteIds())].filter((id) => !before.has(id)));
  } finally {
    for (const id of added) {
      await api(OWNER, "DELETE", `/notes/items/${encodeURIComponent(id)}`).catch(() => undefined);
    }
  }
});

// --- Contacts -------------------------------------------------------------------------------------

type Call = [string, Record<string, unknown>, string];

async function contactsJmap(
  methodCalls: Call[],
): Promise<Array<[string, Record<string, unknown>]>> {
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
    methodCalls,
  });
  if (res.status !== 200) throw new Error(`JMAP ${res.status}: ${JSON.stringify(res.json)}`);
  return (res.json as { methodResponses: never }).methodResponses;
}

async function contactsAccountId(): Promise<string> {
  const res = await api(OWNER, "GET", "/jmap/session");
  return (res.json as { primaryAccounts: Record<string, string> }).primaryAccounts[
    "urn:ietf:params:jmap:contacts"
  ]!;
}

async function serverCardIds(accountId: string): Promise<Set<string>> {
  const [[, q]] = await contactsJmap([
    ["ContactCard/query", { accountId, filter: { inAddressBook: "default" } }, "q"],
  ]);
  return new Set(q.ids as string[]);
}

test("Contacts: a new contact that cannot sync shows Retry above the list until it lands", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const accountId = await contactsAccountId();
  const before = await serverCardIds(accountId);
  const added: string[] = [];
  const given = `Sync${RUN}`;
  const refresh = page.getByRole("button", { name: "Refresh contacts" });
  try {
    await page.goto("/contacts/all");
    // The refresh button stays busy until the first download is finished.
    await expect(refresh).toBeEnabled({ timeout: 60_000 });

    await context.setOffline(true);
    await page.getByRole("button", { name: "New contact", exact: true }).click();
    await page.getByLabel("First name").fill(given);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Save runs after the 2.5 s undo window; let it queue while still offline.
    await page.waitForTimeout(3_500);

    const release = await holdRequests(context, {
      method: "POST",
      url: /\/api\/v1\/jmap(?:\?|$)/,
      bodyIncludes: "ContactCard/set",
    });
    await context.setOffline(false);
    await expectRow(page, SYNC_FAILED, "Retry");
    await expectInSlot(page, ".collection-list-body");
    await retryWhileHeld(page, SYNC_FAILED, "Retry");

    await page.reload();
    await expect(refresh).toBeEnabled({ timeout: 60_000 });
    await expectRow(page, SYNC_FAILED, "Retry");
    expect((await serverCardIds(accountId)).size, "nothing landed while held").toBe(before.size);

    await release();
    await retryClears(page, SYNC_FAILED, "Retry");
    await expect
      .poll(async () => [...(await serverCardIds(accountId))].filter((id) => !before.has(id)), {
        message: "the server has the new contact",
        timeout: 30_000,
      })
      .toHaveLength(1);
    added.push(...[...(await serverCardIds(accountId))].filter((id) => !before.has(id)));
  } finally {
    if (added.length > 0) {
      await contactsJmap([["ContactCard/set", { accountId, destroy: added }, "d"]]).catch(
        () => undefined,
      );
    }
  }
});

// --- Calendar -------------------------------------------------------------------------------------

test("Calendar: a new event that cannot sync shows Retry in every tab until it lands", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const title = `e2e-sync-notice-${RUN}`;
  try {
    await openCalendarWeek(page);
    await context.setOffline(true);
    await expectCalendarOffline(page);
    await createOfflineWeekEvent(page, title);

    const release = await holdRequests(context, {
      method: "POST",
      url: /\/api\/v1\/jmap(?:\?|$)/,
      bodyIncludes: "CalendarEvent/set",
    });
    await context.setOffline(false);
    await expectRow(page, SYNC_FAILED, "Retry");
    await retryWhileHeld(page, SYNC_FAILED, "Retry");

    await page.reload();
    await expect(page.locator(".calendar-workspace")).toBeVisible({ timeout: 30_000 });
    await expectRow(page, SYNC_FAILED, "Retry");

    const second = await context.newPage();
    await openCalendarWeek(second);
    await expectRow(second, SYNC_FAILED, "Retry");
    expect(await countCalendarEventsByTitleViaApi(title), "nothing landed while held").toBe(0);

    await release();
    await retryClears(page, SYNC_FAILED, "Retry");
    await expect(syncNoticeRow(second), "the other tab clears too").toHaveCount(0, SHOWS);
    await expect
      .poll(() => countCalendarEventsByTitleViaApi(title), {
        message: "the server has the event",
        timeout: 30_000,
      })
      .toBe(1);
  } finally {
    await deleteCalendarEventsByTitleViaApi(title).catch(() => undefined);
  }
});

// --- Drive and Docs home --------------------------------------------------------------------------

async function serverStarred(fileName: string): Promise<boolean> {
  const res = await api(OWNER, "GET", "/files/starred");
  const paths = (res.json as { data?: { paths?: string[] } }).data?.paths ?? [];
  return paths.some((path) => path.endsWith(`/${fileName}`));
}

/** Holds the star write, reconnects, and checks the row through to a landed Retry. */
async function starThatCannotSync(
  page: Page,
  context: BrowserContext,
  fileName: string,
  reopen: () => Promise<void>,
  slot?: string,
): Promise<void> {
  const release = await holdRequests(context, { method: "POST", url: /\/api\/v1\/files\/star/ });
  await context.setOffline(false);
  await expectRow(page, SYNC_FAILED_FILES, "Retry sync");
  if (slot) await expectInSlot(page, slot);
  await retryWhileHeld(page, SYNC_FAILED_FILES, "Retry sync");

  await page.reload();
  await reopen();
  await expectRow(page, SYNC_FAILED_FILES, "Retry sync");
  expect(await serverStarred(fileName), "nothing landed while held").toBe(false);

  await release();
  await retryClears(page, SYNC_FAILED_FILES, "Retry sync");
  await expect
    .poll(() => serverStarred(fileName), { message: "the server has the star", timeout: 30_000 })
    .toBe(true);
}

test("Drive: a star that cannot sync shows Retry sync under the header until it lands", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const fileName = `sync-notice-${RUN}.txt`;
  const apiPath = `/${myDriveDocSearchPath(fileName)}`;
  await putDriveFile(apiPath, "sync notice\n", "text/plain");
  const tile = page
    .getByText(fileName, { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='More actions']][1]");
  const open = async () => {
    await page.goto("/drive?view=folder&path=My%20Drive");
    await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 30_000 });
  };
  try {
    await open();
    await context.setOffline(true);
    await tile.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Star" }).click();
    await undoWindowsClosed(page);
    await starThatCannotSync(page, context, fileName, async () => {
      await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    await deleteDriveFile(apiPath).catch(() => undefined);
  }
});

test("Docs home: a star that cannot sync shows Retry sync under the pane header until it lands", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const fileName = `sync-notice-${RUN}.md`;
  const apiPath = `/${myDriveDocSearchPath(fileName)}`;
  await seedDocAtPath(apiPath, "# Sync notice\n");
  try {
    await gotoDocsHome(page);
    await expect(docsHomeRow(page, fileName)).toBeVisible({ timeout: 30_000 });
    await context.setOffline(true);
    await docsHomeRow(page, fileName).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Star" }).click();
    await undoWindowsClosed(page);
    // Docs home's own slot: inside its pane, under the pane header.
    await starThatCannotSync(
      page,
      context,
      fileName,
      async () => {
        await expect(page.locator(".docs-home-pane")).toBeVisible({ timeout: 30_000 });
      },
      ".docs-home-pane",
    );
  } finally {
    await deleteDriveFile(apiPath).catch(() => undefined);
  }
});

// --- Docs document view (collab save) -------------------------------------------------------------

test("Docs document: a save that fails online shows Retry sync until a retry saves", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const fileName = `sync-notice-doc-${RUN}.md`;
  const apiPath = `/${myDriveDocSearchPath(fileName)}`;
  const token = `held-${RUN}`;
  await seedDocAtPath(apiPath, "# Sync notice\n");
  try {
    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-connectivity="online"]')).toBeVisible();
    // Let the room settle before the first edit.
    await page.waitForTimeout(3_000);

    const release = await holdRequests(context, {
      method: "PUT",
      url: /\/api\/v1\/files\/collaboration/,
    });
    await appendToActiveDocBody(page, ` ${token}`);
    await expectRow(page, SYNC_FAILED_FILES, "Retry sync");
    expect(await docTokenOnServer(page, apiPath, token), "nothing landed while held").toBe(false);

    await release();
    await retryClears(page, SYNC_FAILED_FILES, "Retry sync");
    await expect
      .poll(() => docTokenOnServer(page, apiPath, token), {
        message: "the server has the edit",
        timeout: 30_000,
      })
      .toBe(true);
  } finally {
    await deleteDriveFile(apiPath).catch(() => undefined);
  }
});
