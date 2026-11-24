// Contacts photo pass and one first download per browser (live app, #2297).
//
// A new device downloads the address book in pages of up to 200 cards without
// photos, then fetches the photos in a second, paced pass that resumes from
// its marker after a reload. Other tabs never start a download of their own:
// a Calendar tab's invitee search joins the one that is running.
//
// Every test runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Page, type Route } from "./helpers/live-test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
/** Sorts before the dev seed ("dev-…"), so it lands in the first pages. */
const PHOTO_NAME = `Aa Ph${RUN} Photo`;
const INVITEE_NAME = `Aa Ph${RUN} Invitee`;

/** 1×1 PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

async function createCard(api: Jmap, card: Record<string, unknown>): Promise<string> {
  const [[, books]] = await api.call([["AddressBook/get", { accountId: api.accountId }, "b"]]);
  const list = books.list as Array<{ id: string; isDefault?: boolean }>;
  const bookId = (list.find((entry) => entry.isDefault) ?? list[0])!.id;
  const [[, set]] = await api.call([
    [
      "ContactCard/set",
      {
        accountId: api.accountId,
        create: {
          c: { "@type": "Card", version: "1.0", addressBookIds: { [bookId]: true }, ...card },
        },
      },
      "s",
    ],
  ]);
  const id = (set.created as Record<string, { id: string }> | undefined)?.c?.id;
  if (!id) throw new Error(`Seeding failed: ${JSON.stringify(set.notCreated)}`);
  return id;
}

async function serverCardCount(api: Jmap): Promise<number> {
  const [[, query]] = await api.call([["ContactCard/query", { accountId: api.accountId }, "q"]]);
  return (query.ids as string[]).length;
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

const isPhotoGet = (get: CardGet) =>
  JSON.stringify([...(get.properties ?? [])].sort()) === JSON.stringify(["media", "state"]);

type Stored = { withMedia: string[]; unfinished: boolean; photoPass: string[] | null };

/** What the offline store holds: cards with a photo, and the two download markers. */
async function stored(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const out = {
      withMedia: [] as string[],
      unfinished: false,
      photoPass: null as string[] | null,
    };
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
        const cold = tx.objectStore("meta").get("contacts:coldDownload");
        const photos = tx.objectStore("meta").get("contacts:photoPass");
        await new Promise((resolve) => {
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
        for (const row of rows.result as Array<{ id: string; data: string }>) {
          if (row.data.includes('"media"')) out.withMedia.push(row.id);
        }
        out.unfinished ||= Boolean(cold.result);
        const pass = (photos.result as { value?: string } | undefined)?.value;
        if (pass) out.photoPass = (JSON.parse(pass) as { cardIds: string[] }).cardIds;
      }
      db.close();
    }
    return out;
  });
}

/** The avatar photo of a contact's list row (none while it shows initials). */
function rowPhoto(page: Page, cardId: string) {
  return page.locator(`[data-list-item-id="${cardId}"] img.user-avatar__image`);
}

async function search(page: Page, text: string): Promise<void> {
  const box = page.getByPlaceholder("Search contacts...");
  await box.fill("");
  await box.fill(text);
}

test.describe("Contacts photo pass and one download per browser", () => {
  test.describe.configure({ mode: "serial" });
  // page.route must see the app's own requests, not a service worker's.
  test.use({ serviceWorkers: "block" });

  let api: Jmap;
  const created: string[] = [];

  test.beforeAll(async () => {
    api = await jmap();
    created.push(
      await createCard(api, {
        name: { "@type": "Name", full: PHOTO_NAME },
        media: {
          m1: { "@type": "Media", kind: "photo", uri: `data:image/png;base64,${PNG_BASE64}` },
        },
      }),
    );
    created.push(
      await createCard(api, {
        name: { "@type": "Name", full: INVITEE_NAME },
        emails: { e1: { "@type": "EmailAddress", address: `invitee-${RUN}@example.test` } },
      }),
    );
    // More than one photo page (200 cards): the dev seed has about a thousand.
    expect(await serverCardCount(api)).toBeGreaterThan(400);
  });

  test.afterAll(async () => {
    await api.call([["ContactCard/set", { accountId: api.accountId, destroy: created }, "d"]]);
  });

  test("photos follow the photo-less pages, and a reload mid-pass resumes from the marker", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const [photoId] = created;
    const cardPages: CardGet[] = [];
    const photoPages: CardGet[] = [];
    /** Photo pages to hold, counted from the start of the current page load. */
    let holdPhotoPage = 1;
    let photoPagesThisLoad = 0;
    const held: Route[] = [];
    await page.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (!get) return route.continue();
      if (!isPhotoGet(get)) {
        cardPages.push(get);
        return route.continue();
      }
      photoPages.push(get);
      photoPagesThisLoad += 1;
      if (photoPagesThisLoad === holdPhotoPage) {
        held.push(route);
        return;
      }
      return route.continue();
    });
    const reload = async () => {
      photoPagesThisLoad = 0;
      const stuck = held.splice(0);
      await page.reload();
      for (const route of stuck) await route.abort("internetdisconnected").catch(() => undefined);
    };

    // 1. The card pages carry no photos and hold at most 200 cards.
    await page.goto("/contacts/all");
    await expect.poll(() => held.length, { timeout: 120_000 }).toBe(1);
    expect(cardPages.length).toBeGreaterThan(1);
    for (const get of cardPages) {
      expect(get.ids.length).toBeLessThanOrEqual(200);
      expect(get.properties ?? []).toContain("name");
      expect(get.properties ?? []).not.toContain("media");
    }
    const firstPhotoPage = photoPages[0]!;
    expect(firstPhotoPage.ids).toContain(photoId);

    // While its photo page is held: initials, and the marker still lists it.
    let now = await stored(page);
    expect(now.unfinished).toBe(false);
    expect(now.withMedia).not.toContain(photoId);
    expect(now.photoPass).toContain(photoId);
    await search(page, PHOTO_NAME);
    await expect(page.getByText(PHOTO_NAME, { exact: true }).first()).toBeVisible();
    await expect(rowPhoto(page, photoId!)).toHaveCount(0);

    // 2. Reload while the first photo page is held: the pass starts again from the marker.
    holdPhotoPage = 2;
    await reload();
    await expect.poll(() => held.length, { timeout: 60_000 }).toBe(1);
    now = await stored(page);
    expect(now.withMedia).toContain(photoId);
    expect(now.photoPass).not.toContain(photoId);
    await search(page, PHOTO_NAME);
    await expect(rowPhoto(page, photoId!)).toHaveCount(1, { timeout: 20_000 });
    const savedPage = photoPages.at(-2)!;

    // 3. Reload while the second page is held: the saved page is not asked for again.
    holdPhotoPage = 0;
    const photoPagesBefore = photoPages.length;
    const cardPagesBefore = cardPages.length;
    await reload();
    await expect.poll(async () => (await stored(page)).photoPass, { timeout: 120_000 }).toBeNull();
    const afterReload = photoPages.slice(photoPagesBefore).flatMap((get) => get.ids);
    expect(afterReload.length).toBeGreaterThan(0);
    expect(afterReload.filter((id) => savedPage.ids.includes(id))).toEqual([]);
    // The photo never came through a card page: no card page after the first download.
    expect(cardPages.slice(cardPagesBefore)).toEqual([]);
    await search(page, PHOTO_NAME);
    await expect(rowPhoto(page, photoId!)).toHaveCount(1, { timeout: 20_000 });
  });

  test("a Calendar tab's invitee search joins the running download instead of starting one", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const pagesByTab = { contacts: [] as string[][], calendar: [] as string[][] };
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Tab A: Contacts' first download, held after its first card page.
    await page.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (!get || isPhotoGet(get)) return route.continue();
      pagesByTab.contacts.push(get.ids);
      if (pagesByTab.contacts.length === 2) await released;
      return route.continue();
    });
    await page.goto("/contacts/all");
    await expect.poll(() => pagesByTab.contacts.length, { timeout: 60_000 }).toBe(2);

    // Tab B: Calendar, same browser, searching for an invitee meanwhile.
    const calendar = await page.context().newPage();
    await calendar.route("**/api/v1/jmap", async (route) => {
      const get = cardGet(route);
      if (get && !isPhotoGet(get)) pagesByTab.calendar.push(get.ids);
      return route.continue();
    });
    await calendar.goto("/calendar");
    await expect(calendar.locator(".calendar-workspace")).toBeVisible({ timeout: 30_000 });
    await calendar.getByRole("button", { name: "New event" }).click();
    const input = calendar.getByLabel("Add participants");
    await input.fill("Aa Ph");
    await calendar.waitForTimeout(5_000);
    expect(pagesByTab.calendar, "card pages from the Calendar tab").toEqual([]);

    // Tab A's download goes on; the Calendar search then suggests the contact.
    release();
    await input.fill("");
    await expect
      .poll(
        async () => {
          await input.fill(INVITEE_NAME);
          return calendar.getByRole("option", { name: new RegExp(INVITEE_NAME) }).count();
        },
        { timeout: 120_000, intervals: [3_000] },
      )
      .toBeGreaterThan(0);

    // Wait for the whole download (and the Calendar tab's turn at the lock) before counting.
    await expect
      .poll(async () => (await stored(page)).unfinished, { timeout: 120_000 })
      .toBe(false);
    await calendar.waitForTimeout(3_000);
    expect(pagesByTab.calendar, "card pages from the Calendar tab").toEqual([]);
    // One download: no card was asked for twice.
    const all = pagesByTab.contacts.flat();
    expect(new Set(all).size).toBe(all.length);
    await calendar.close();
  });
});
