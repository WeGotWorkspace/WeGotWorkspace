// Contacts lean first download and detail pass (live app, Epic #2284).
//
// A new device downloads name, emails and what the list needs in pages of up to
// 500 cards, then fetches the rest of every card (phones, addresses, notes) in a
// second paced pass, then the photos. Until its details are in, a card is
// partial: it opens read-only, and is never saved from its partial copy.
//
// Every test runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Page, type Route } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
/** Sorts before the dev seed, so it lands in the first lean page. */
const NAME = `Aa Dp${RUN} Detail`;
const PHONE = "+31 6 5550 1234";
const NOTE = `Note ${RUN} from the whole card`;

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

async function createRichCard(api: Jmap): Promise<string> {
  const [[, books]] = await api.call([["AddressBook/get", { accountId: api.accountId }, "b"]]);
  const list = books.list as Array<{ id: string; isDefault?: boolean }>;
  const bookId = (list.find((entry) => entry.isDefault) ?? list[0])!.id;
  const [[, set]] = await api.call([
    [
      "ContactCard/set",
      {
        accountId: api.accountId,
        create: {
          c: {
            "@type": "Card",
            version: "1.0",
            addressBookIds: { [bookId]: true },
            name: { "@type": "Name", full: NAME },
            emails: { e1: { "@type": "EmailAddress", address: `zz${RUN}@example.test` } },
            phones: { p1: { "@type": "Phone", number: PHONE } },
            notes: { n1: { "@type": "Note", note: NOTE } },
          },
        },
      },
      "s",
    ],
  ]);
  const id = (set.created as Record<string, { id: string }> | undefined)?.c?.id;
  if (!id) throw new Error(`Seeding failed: ${JSON.stringify(set.notCreated)}`);
  return id;
}

type CardGet = { ids: string[]; properties: string[] | null };

/** The one ContactCard/get with explicit ids in a request, or null. */
function cardGet(route: Route): CardGet | null {
  const body = JSON.parse(route.request().postData() ?? "{}") as {
    methodCalls?: Array<[string, { ids?: string[] | null; properties?: string[] }, string]>;
  };
  const calls = body.methodCalls ?? [];
  if (calls.length !== 1 || calls[0]![0] !== "ContactCard/get") return null;
  const { ids, properties } = calls[0]![1];
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return { ids, properties: properties ?? null };
}

const has = (get: CardGet, property: string) => (get.properties ?? []).includes(property);
const isPhotoGet = (get: CardGet) => has(get, "media") && !has(get, "name");
/** A detail page asks for everything but the photo; a lean page leaves phones out. */
const isDetailGet = (get: CardGet) => has(get, "phones") && !has(get, "media");
const isLeanGet = (get: CardGet) => has(get, "name") && !has(get, "phones");
/** The whole card of one opened contact: no projection at all. */
const isWholeCardGet = (get: CardGet) => get.properties === null && get.ids.length === 1;

type Stored = { partial: string[] | null; cardWithPhones: string[]; cards: number };

/** What the offline store holds: the partial list, and which cards carry phones. */
async function stored(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const out = { partial: null as string[] | null, cardWithPhones: [] as string[], cards: 0 };
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("wgw-offline-")) continue;
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const open = indexedDB.open(info.name!);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => resolve(null);
      });
      if (!db) continue;
      if (db.objectStoreNames.contains("contacts_cards")) {
        const tx = db.transaction(["contacts_cards", "meta"], "readonly");
        const rows = tx.objectStore("contacts_cards").getAll();
        const pass = tx.objectStore("meta").get("contacts:detailPass");
        await new Promise((resolve) => {
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        const list = rows.result as Array<{ id: string; data: string }>;
        out.cards = list.length;
        for (const row of list) {
          if (row.data.includes('"phones"')) out.cardWithPhones.push(row.id);
        }
        const value = (pass.result as { value?: string } | undefined)?.value;
        out.partial = value ? (JSON.parse(value) as { cardIds: string[] }).cardIds : null;
      }
      db.close();
    }
    return out;
  });
}

/** The phone number of the open contact: it sits in a field, read-only or not. */
function phoneField(page: Page) {
  return page.locator("input").and(page.locator(`[value="${PHONE}"]`));
}

async function search(page: Page, text: string): Promise<void> {
  const box = page.getByPlaceholder("Search contacts...");
  await box.fill("");
  await box.fill(text);
}

test.describe("Contacts lean first download and detail pass", () => {
  test.describe.configure({ mode: "serial" });
  // page.route must see the app's own requests, not a service worker's.
  test.use({ serviceWorkers: "block" });

  let api: Jmap;
  let cardId = "";

  test.beforeAll(async () => {
    api = await jmap();
    cardId = await createRichCard(api);
  });

  test.afterAll(async () => {
    await api.call([["ContactCard/set", { accountId: api.accountId, destroy: [cardId] }, "d"]]);
  });

  test("the first pages are lean, a partial card opens read-only until its whole card is fetched", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const leanPages: CardGet[] = [];
    const detailPages: CardGet[] = [];
    const wholeCardGets: CardGet[] = [];
    const held: Route[] = [];
    // Hold the first detail page: every card stays partial while the test looks.
    await page.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (!get || isPhotoGet(get)) return route.continue();
      if (isDetailGet(get)) {
        detailPages.push(get);
        held.push(route);
        return;
      }
      if (isLeanGet(get)) leanPages.push(get);
      if (isWholeCardGet(get)) wholeCardGets.push(get);
      return route.continue();
    });

    await page.goto("/contacts/all");
    await expect.poll(() => held.length, { timeout: 120_000 }).toBe(1);

    // 1. Lean pages of at most 500 cards, with no phones, notes or photos.
    expect(leanPages.length).toBeGreaterThan(0);
    for (const get of leanPages) {
      expect(get.ids.length).toBeLessThanOrEqual(500);
      expect(get.properties).toEqual(expect.arrayContaining(["name", "emails"]));
      for (const detail of ["phones", "addresses", "notes", "media"]) {
        expect(get.properties).not.toContain(detail);
      }
    }
    const before = await stored(page);
    expect(before.partial).toContain(cardId);
    expect(before.cardWithPhones).not.toContain(cardId);

    // 2. The list shows name and email alone.
    await search(page, NAME);
    const row = page.locator(`[data-list-item-id="${cardId}"]`);
    await expect(row).toBeVisible();
    // The row's second line is its email: lean cards carry it.
    await expect(row.getByText(`zz${RUN}@example.test`)).toBeVisible();

    // 3. Opening the partial card: read-only with a note, and its whole card is fetched at once.
    await row.click();
    await expect.poll(() => wholeCardGets.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(wholeCardGets[0]!.ids).toEqual([cardId]);
    await expect(phoneField(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#contact-notes")).toHaveValue(NOTE);
    const after = await stored(page);
    expect(after.partial ?? []).not.toContain(cardId);
    expect(after.cardWithPhones).toContain(cardId);
    for (const route of held.splice(0))
      await route.abort("internetdisconnected").catch(() => undefined);
  });

  test("offline, a partial card stays read-only with a clear note and queues nothing; online it completes", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const held: Route[] = [];
    let holdDetails = true;
    await page.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (get && isDetailGet(get) && holdDetails) {
        held.push(route);
        return;
      }
      return route.continue();
    });
    await page.goto("/contacts/all");
    await expect.poll(() => held.length, { timeout: 120_000 }).toBe(1);
    expect((await stored(page)).partial).toContain(cardId);

    await context.setOffline(true);
    await search(page, NAME);
    const row = page.locator(`[data-list-item-id="${cardId}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText("not downloaded yet")).toBeVisible({ timeout: 20_000 });
    // No phone or note from a copy that never had them, and nothing to type into.
    await expect(phoneField(page)).toHaveCount(0);
    await expect(page.locator("#contact-notes")).toHaveCount(0);
    expect((await stored(page)).partial).toContain(cardId);

    // Back online: the card is fetched whole and the note goes away.
    await context.setOffline(false);
    await expect(phoneField(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("not downloaded yet")).toHaveCount(0);
    holdDetails = false;
    for (const route of held.splice(0))
      await route.abort("internetdisconnected").catch(() => undefined);
  });

  test("the pass completes every card and a reload mid-pass resumes from the marker", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const detailPages: CardGet[] = [];
    const held: Route[] = [];
    let holdSecond = true;
    await page.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (!get || !isDetailGet(get)) return route.continue();
      detailPages.push(get);
      if (holdSecond && detailPages.length === 2) {
        held.push(route);
        return;
      }
      return route.continue();
    });

    await page.goto("/contacts/all");
    await expect.poll(() => held.length, { timeout: 150_000 }).toBe(1);
    for (const get of detailPages) {
      expect(get.ids.length).toBeLessThanOrEqual(200);
      expect(get.properties).not.toContain("media");
    }
    const firstPage = detailPages[0]!.ids;
    const midway = await stored(page);
    expect(midway.partial).not.toBeNull();
    expect(midway.partial).not.toContain(firstPage[0]);

    // Reload with the second page held: the pass starts again from the marker, not from the top.
    holdSecond = false;
    const pagesBefore = detailPages.length;
    await page.reload();
    for (const route of held.splice(0))
      await route.abort("internetdisconnected").catch(() => undefined);
    await expect.poll(async () => (await stored(page)).partial, { timeout: 180_000 }).toBeNull();
    const afterReload = detailPages.slice(pagesBefore).flatMap((get) => get.ids);
    expect(afterReload.length).toBeGreaterThan(0);
    expect(afterReload.filter((id) => firstPage.includes(id))).toEqual([]);
    const done = await stored(page);
    expect(done.cardWithPhones).toContain(cardId);
  });
});
