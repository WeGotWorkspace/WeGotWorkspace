// Contacts first download on a new device (live app, #1748).
//
// The first open of Contacts downloads the cards in pages of
// CONTACT_CARD_GET_MAX_IDS_PER_REQUEST (40). Each page is saved as it
// arrives. A reload halfway must keep those cards, show them offline, fetch
// only the missing ones once online, and replay what changed on the server in
// between (the sync anchor is the state at query time).
//
// Every test runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
/** More than 2 × 40, so the download takes at least three card pages. */
const SEED_COUNT = 100;
/**
 * Names end in a number, so they sort under "#" at the top of the list, and
 * their ids (a slug of the name) sort before seeded "dev-…" cards: the
 * query, ordered by id, puts them in the first pages.
 */
const seededName = (n: number) => `Aa Fd${RUN} ${String(n).padStart(3, "0")}`;
const CREATED_OFFLINE = `Aa Fd${RUN} created while offline`;
const OFFLINE_FLAG = "e2e-contacts-offline";

/** "Ensure navigator.onLine is false on load" switch, read by an init script. */
// Playwright cannot remove an init script, so it reads a sessionStorage flag.
async function installOfflineSwitch(page: Page): Promise<void> {
  await page.addInitScript((flag) => {
    if (sessionStorage.getItem(flag) !== "1") return;
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  }, OFFLINE_FLAG);
}

/** Offline the way the app sees it: navigator.onLine false and the API unreachable. */
async function goOffline(page: Page): Promise<void> {
  await page.evaluate((flag) => sessionStorage.setItem(flag, "1"), OFFLINE_FLAG);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) return route.abort("internetdisconnected");
    if (route.request().method() === "HEAD" && url.pathname === "/") {
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
}

async function goOnline(page: Page): Promise<void> {
  await page.unroute("**/*");
  await page.evaluate((flag) => sessionStorage.removeItem(flag), OFFLINE_FLAG);
}

type Jmap = {
  call: (methodCalls: unknown[]) => Promise<Array<[string, Record<string, unknown>, string]>>;
  accountId: string;
};

async function jmap(): Promise<Jmap> {
  const token = (await (
    await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
    })
  ).json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${token.access_token}` };
  const session = (await (await fetch(`${API}/api/v1/jmap/session`, { headers: auth })).json()) as {
    primaryAccounts: Record<string, string>;
  };
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:contacts"]!;
  return {
    accountId,
    call: async (methodCalls) => {
      const res = await fetch(`${API}/api/v1/jmap`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
          methodCalls,
        }),
      });
      if (!res.ok) throw new Error(`JMAP ${res.status}: ${await res.text()}`);
      return ((await res.json()) as { methodResponses: never }).methodResponses;
    },
  };
}

async function defaultBookId(api: Jmap): Promise<string> {
  const [[, books]] = await api.call([["AddressBook/get", { accountId: api.accountId }, "b"]]);
  const list = books.list as Array<{ id: string; isDefault?: boolean }>;
  const book = list.find((entry) => entry.isDefault) ?? list[0];
  if (!book) throw new Error("No address book to seed into");
  return book.id;
}

/** Creates cards and returns their ids, in the order of `names`. */
async function createCards(api: Jmap, bookId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (let start = 0; start < names.length; start += 20) {
    const batch = names.slice(start, start + 20);
    const create = Object.fromEntries(
      batch.map((full, index) => [
        `c${index}`,
        {
          "@type": "Card",
          version: "1.0",
          addressBookIds: { [bookId]: true },
          name: { "@type": "Name", full },
        },
      ]),
    );
    const [[, set]] = await api.call([
      ["ContactCard/set", { accountId: api.accountId, create }, "s"],
    ]);
    const created = set.created as Record<string, { id: string }> | undefined;
    for (const [index] of batch.entries()) {
      const id = created?.[`c${index}`]?.id;
      if (!id) throw new Error(`Seeding failed: ${JSON.stringify(set.notCreated)}`);
      ids.push(id);
    }
  }
  return ids;
}

async function destroyCards(api: Jmap, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += 50) {
    await api.call([
      ["ContactCard/set", { accountId: api.accountId, destroy: ids.slice(start, start + 50) }, "d"],
    ]);
  }
}

async function serverCardCount(api: Jmap): Promise<number> {
  const [[, query]] = await api.call([["ContactCard/query", { accountId: api.accountId }, "q"]]);
  return (query.ids as string[]).length;
}

/** Cards All Contacts counts: every card except groups. */
async function serverContactCount(api: Jmap): Promise<number> {
  const [[, groups]] = await api.call([
    ["ContactCard/query", { accountId: api.accountId, filter: { kind: "group" } }, "g"],
  ]);
  return (await serverCardCount(api)) - (groups.ids as string[]).length;
}

/** The All Contacts header count, such as "(1000)". */
function headerCount(page: Page) {
  return page.locator(".view-header__title-count").first();
}

/** Ids of a page request: one ContactCard/get with explicit ids (not the empty state get). */
function cardPageIds(route: Route): string[] | null {
  const body = JSON.parse(route.request().postData() ?? "{}") as {
    methodCalls?: Array<[string, { ids?: string[] | null }, string]>;
  };
  const calls = body.methodCalls ?? [];
  if (calls.length !== 1 || calls[0]![0] !== "ContactCard/get") return null;
  const ids = calls[0]![1].ids;
  return Array.isArray(ids) && ids.length > 0 ? ids : null;
}

type Stored = { ids: string[]; unfinished: boolean };

/** Card ids in the offline store and whether the first download is still unfinished. */
async function storedContacts(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((entry) => entry.name ?? "")
      .filter((name) => name.startsWith("wgw-offline-"));
    const result = { ids: [] as string[], unfinished: false };
    for (const name of names) {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      if (db.objectStoreNames.contains("contacts_cards")) {
        const tx = db.transaction(["contacts_cards", "meta"], "readonly");
        const ids = tx.objectStore("contacts_cards").getAllKeys();
        const marker = tx.objectStore("meta").get("contacts:coldDownload");
        await new Promise((resolve) => {
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        result.ids.push(...(ids.result as string[]));
        result.unfinished ||= Boolean(marker.result);
      }
      db.close();
    }
    return result;
  });
}

async function search(page: Page, text: string): Promise<void> {
  const box = page.getByPlaceholder("Search contacts...");
  await box.fill("");
  await box.fill(text);
}

test.describe("Contacts first download on a new device", () => {
  test.describe.configure({ mode: "serial" });
  // page.route must see the app's own requests, not a service worker's.
  test.use({ serviceWorkers: "block" });

  let api: Jmap;
  let seededIds: string[] = [];
  const createdIds: string[] = [];

  test.beforeAll(async () => {
    api = await jmap();
    const bookId = await defaultBookId(api);
    seededIds = await createCards(
      api,
      bookId,
      Array.from({ length: SEED_COUNT }, (_, i) => seededName(i + 1)),
    );
  });

  test.afterAll(async () => {
    await destroyCards(api, [...seededIds, ...createdIds]);
  });

  test("a reload keeps the saved pages, offline shows them, online fetches only the rest", async ({
    page,
  }) => {
    await installOfflineSwitch(page);

    // 1. First open: page 1 goes through, page 2 is held, as if the tab closes there.
    const firstOpenPages: string[][] = [];
    let releaseHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    await page.route("**/api/v1/jmap", async (route) => {
      const ids = cardPageIds(route);
      if (!ids) return route.continue();
      firstOpenPages.push(ids);
      if (firstOpenPages.length === 1) return route.continue();
      await held;
      await route.abort("internetdisconnected").catch(() => undefined);
    });
    await page.goto("/contacts/all");

    let beforeReload: Stored = { ids: [], unfinished: false };
    await expect
      .poll(async () => (beforeReload = await storedContacts(page)).ids.length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await expect.poll(() => firstOpenPages.length, { timeout: 30_000 }).toBeGreaterThan(1);
    beforeReload = await storedContacts(page);
    const firstPage = new Set(firstOpenPages[0]);
    expect(beforeReload.unfinished, "first download still unfinished").toBe(true);
    expect(beforeReload.ids.sort()).toEqual([...firstPage].sort());
    const keptSeeded = seededIds.filter((id) => firstPage.has(id));
    expect(keptSeeded.length, "seeded cards in the first page").toBeGreaterThan(1);
    const keptName = seededName(seededIds.indexOf(keptSeeded[0]!) + 1);
    await search(page, keptName);
    await expect(page.getByText(keptName, { exact: true }).first()).toBeVisible();

    // 2. Offline reload: the saved cards open; no error, no empty book.
    await page.unroute("**/api/v1/jmap");
    releaseHeld();
    await goOffline(page);
    await page.reload();
    await search(page, keptName);
    await expect(page.getByText(keptName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No cached contacts available offline")).toHaveCount(0);
    await expect(page.getByText("Could not load live contacts")).toHaveCount(0);
    expect((await storedContacts(page)).unfinished).toBe(true);

    // The resume counts from the first download's query, before the offline changes.
    const contactsAtQuery = await serverContactCount(api);

    // 3. While offline, the server changes: one contact created, one stored card deleted.
    const deletedId = keptSeeded[1]!;
    const deletedName = seededName(seededIds.indexOf(deletedId) + 1);
    createdIds.push(...(await createCards(api, await defaultBookId(api), [CREATED_OFFLINE])));
    await destroyCards(api, [deletedId]);
    seededIds = seededIds.filter((id) => id !== deletedId);
    const serverTotal = await serverCardCount(api);
    const contactsNow = await serverContactCount(api);

    // 4. Online reload: the stored names show first, then only the missing cards are fetched.
    await goOnline(page);
    const afterPages: string[][] = [];
    let releaseFirstResumePage: () => void = () => undefined;
    const firstResumePage = new Promise<void>((resolve) => {
      releaseFirstResumePage = resolve;
    });
    await page.route("**/api/v1/jmap", async (route) => {
      const ids = cardPageIds(route);
      if (!ids) return route.continue();
      afterPages.push(ids);
      if (afterPages.length === 1) await firstResumePage;
      return route.continue();
    });
    await page.reload();
    await search(page, keptName);
    await expect(page.getByText(keptName, { exact: true }).first()).toBeVisible();
    await expect.poll(() => afterPages.length, { timeout: 30_000 }).toBe(1);
    // With only the first page stored, the header already shows the whole book.
    await search(page, "");
    await expect(headerCount(page)).toHaveText(`(${contactsAtQuery})`);
    releaseFirstResumePage();

    // Header counts seen while the rest arrives: the total, never a count that climbs.
    const headerCounts = new Set<string>();
    await expect
      .poll(
        async () => {
          const shown = await headerCount(page)
            .textContent({ timeout: 1_000 })
            .catch(() => null);
          if (shown) headerCounts.add(shown);
          const now = await storedContacts(page);
          const ids = new Set(now.ids);
          return {
            unfinished: now.unfinished,
            seededMissing: seededIds.filter((id) => !ids.has(id)).length,
            created: createdIds.every((id) => ids.has(id)),
            deletedGone: !ids.has(deletedId),
            total: now.ids.length,
          };
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toEqual({
        unfinished: false,
        seededMissing: 0,
        created: true,
        deletedGone: true,
        total: serverTotal,
      });

    // One created, one deleted: before and after /changes the total is the same.
    expect(contactsNow).toBe(contactsAtQuery);
    expect([...headerCounts]).toEqual([`(${contactsAtQuery})`]);

    // No card the first page stored is asked for again.
    const refetched = afterPages.flat().filter((id) => firstPage.has(id));
    expect(refetched).toEqual([]);

    // The list shows the whole book, the contact created offline, not the deleted one.
    await search(page, "");
    await expect(headerCount(page)).toHaveText(`(${contactsNow})`);
    await search(page, CREATED_OFFLINE);
    await expect(page.getByText(CREATED_OFFLINE, { exact: true }).first()).toBeVisible();
    await search(page, deletedName);
    await expect(page.getByText(deletedName, { exact: true })).toHaveCount(0);
  });
});
