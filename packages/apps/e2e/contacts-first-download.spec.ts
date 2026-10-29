// Contacts first download on a new device, interrupted (live app).
//
// The first download saves each card page as it arrives, behind a "not
// finished" marker. A reload in the middle must show what is saved, an offline
// open must show it too (not an error, not an empty book), and the next online
// load must fetch only the missing cards, then replay what changed in between.
//
// The test runs in a fresh browser context: nothing cached, like a new device.
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERNAME } from "./helpers/notes-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const RUN = Date.now().toString(36);
/** More than 2 × CONTACT_CARD_GET_MAX_IDS_PER_REQUEST (40): at least three card pages. */
const SEEDED = Array.from({ length: 100 }, (_, i) => `Resume ${RUN} ${String(i).padStart(3, "0")}`);
const LATE = `Resume ${RUN} late`;
const authFile = "e2e/.auth/admin.json";

type Auth = { headers: Record<string, string>; accountId: string };

async function jmapAuth(): Promise<Auth> {
  const token = (await (
    await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
    })
  ).json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const session = (await (await fetch(`${API}/api/v1/jmap/session`, { headers })).json()) as {
    primaryAccounts: Record<string, string>;
  };
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:contacts"];
  if (!accountId) throw new Error("No contacts account in the JMAP session");
  return { headers, accountId };
}

async function jmap(auth: Auth, method: string, args: Record<string, unknown>) {
  const res = await fetch(`${API}/api/v1/jmap`, {
    method: "POST",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
      methodCalls: [[method, { accountId: auth.accountId, ...args }, "c0"]],
    }),
  });
  const body = (await res.json()) as { methodResponses: Array<[string, Record<string, any>]> };
  return body.methodResponses[0]![1];
}

async function createCards(auth: Auth, names: string[]): Promise<Record<string, string>> {
  const books = await jmap(auth, "AddressBook/get", { ids: null });
  const bookId = (books.list as Array<{ id: string; isDefault?: boolean }>).find(
    (b) => b.isDefault,
  )?.id;
  if (!bookId) throw new Error("No default address book");
  const create = Object.fromEntries(
    names.map((name, i) => [
      `k${i}`,
      { addressBookIds: { [bookId]: true }, name: { "@type": "Name", full: name } },
    ]),
  );
  const res = await jmap(auth, "ContactCard/set", { create });
  if (Object.keys(res.notCreated ?? {}).length > 0) {
    throw new Error(`Seeding failed: ${JSON.stringify(res.notCreated)}`);
  }
  return Object.fromEntries(names.map((name, i) => [name, res.created[`k${i}`].id as string]));
}

/** Ids of every non-empty ContactCard/get in a JMAP request body. */
function cardGetIds(postData: string | null): string[] {
  if (!postData) return [];
  const calls = (JSON.parse(postData) as { methodCalls?: Array<[string, any, string]> })
    .methodCalls;
  return (calls ?? [])
    .filter(([method, args]) => method === "ContactCard/get" && Array.isArray(args?.ids))
    .flatMap(([, args]) => args.ids as string[]);
}

/** Card names a ContactCard/get response carries. */
function cardGetNames(text: string): string[] {
  const body = JSON.parse(text) as { methodResponses?: Array<[string, any]> };
  return (body.methodResponses ?? [])
    .filter(([method]) => method === "ContactCard/get")
    .flatMap(([, result]) => (result.list ?? []) as Array<{ name?: { full?: string } }>)
    .map((card) => card.name?.full ?? "")
    .filter(Boolean);
}

/** Names of this run's cards in the offline copy (read straight from IndexedDB). */
async function storedRunNames(page: Page): Promise<string[]> {
  return page.evaluate(async (prefix) => {
    const names: string[] = [];
    const databases = (await indexedDB.databases())
      .map((entry) => entry.name ?? "")
      .filter((name) => name.startsWith("wgw-offline-"));
    for (const name of databases) {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) continue;
      if (db.objectStoreNames.contains("contacts_cards")) {
        const rows = await new Promise<Array<{ data: string }>>((resolve) => {
          const get = db
            .transaction("contacts_cards", "readonly")
            .objectStore("contacts_cards")
            .getAll();
          get.onsuccess = () => resolve(get.result as never);
          get.onerror = () => resolve([]);
        });
        for (const row of rows) {
          const full = (JSON.parse(row.data) as { name?: { full?: string } }).name?.full ?? "";
          if (full.startsWith(prefix)) names.push(full);
        }
      }
      db.close();
    }
    return names;
  }, `Resume ${RUN}`);
}

test.describe("Contacts first download, interrupted", () => {
  test("a reload and an offline open keep the saved pages; the rest is fetched once", async ({
    browser,
  }) => {
    const auth = await jmapAuth();
    const ids = await createCards(auth, SEEDED);

    const context = await browser.newContext({ storageState: authFile });
    const page: Page = await context.newPage();
    // The reachability probe and the API fail together, like a dropped connection.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });

    type Mode = "download" | "offline" | "online";
    let mode: Mode = "download";
    /** Ids and names of the pages that went through before the hold. */
    const storedIds: string[] = [];
    const storedNames: string[] = [];
    const seededIds = new Set(Object.values(ids));
    let held = false;
    let heldRequest: (() => void) | null = null;
    const askedAfterOnline: string[] = [];

    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (mode === "offline") {
        if (
          (request.method() === "HEAD" && url.pathname === "/") ||
          url.pathname.includes("/api/v1/")
        ) {
          return route.abort("failed");
        }
        return route.continue();
      }
      if (url.pathname !== "/api/v1/jmap" || request.method() !== "POST") return route.continue();
      const asked = cardGetIds(request.postData());
      if (asked.length === 0) return route.continue();
      if (mode === "online") {
        askedAfterOnline.push(...asked);
        return route.continue();
      }
      // The account holds other contacts too: pages pass until one has a seeded
      // card, then the next page is held.
      if (storedIds.some((id) => seededIds.has(id))) {
        held = true;
        await new Promise<void>((resolve) => {
          heldRequest = resolve;
        });
        return route.abort("failed").catch(() => undefined);
      }
      const response = await route.fetch();
      storedIds.push(...asked);
      storedNames.push(...cardGetNames(await response.text()));
      return route.fulfill({ response });
    });

    try {
      await page.goto("/contacts");
      await expect.poll(() => held, { timeout: 60_000 }).toBe(true);
      const seededStored = SEEDED.filter((name) => storedNames.includes(name));
      expect(seededStored.length).toBeGreaterThan(0);
      const deleted = seededStored[0]!;
      await expect(page.getByText(deleted, { exact: true }).first()).toBeVisible();

      // Offline, with the second page held: reload and open on the saved part.
      mode = "offline";
      heldRequest?.();
      await page.reload();
      await expect(page.getByText(deleted, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("No cached contacts available offline")).toHaveCount(0);
      await expect(page.getByText("Could not load live contacts")).toHaveCount(0);

      // While offline, the server changes: one card created, one saved card removed.
      Object.assign(ids, await createCards(auth, [LATE]));
      await jmap(auth, "ContactCard/set", { destroy: [ids[deleted]!] });

      // Online again: only the missing cards are asked for.
      mode = "online";
      await page.reload();
      // The list is long and rendered in part: read the stored copy of this run's cards.
      await expect
        .poll(async () => (await storedRunNames(page)).sort(), { timeout: 60_000 })
        .toEqual([...SEEDED.filter((name) => name !== deleted), LATE].sort());
      const missing = SEEDED.filter((name) => !storedNames.includes(name));

      const savedIds = new Set(storedIds);
      expect(askedAfterOnline.filter((id) => savedIds.has(id))).toEqual([]);
      for (const name of missing) {
        expect(askedAfterOnline, `${name} fetched`).toContain(ids[name]!);
      }
      await expect(page.getByText(deleted, { exact: true })).toHaveCount(0, { timeout: 30_000 });
    } finally {
      heldRequest?.();
      await context.close();
      await jmap(auth, "ContactCard/set", { destroy: Object.values(ids) });
    }
  });
});
