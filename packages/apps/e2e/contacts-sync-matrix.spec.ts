// Contacts sync matrix (live app, #1565). The inbound side of Contacts: changes
// made elsewhere (through JMAP, as a phone or a CardDAV client would) reach the
// tab's cache through each address book's stored token, an expired token falls
// back to a full list of the book, and a queued local write is a conflict only
// when the same card changed elsewhere.
//
// The per-book pull runs when the app opens with a copy (`refreshCachedContacts`)
// and after a reconnect (`flushContactsOutbox`). The live JMAP adapter starts
// from the server's current state on every load, so a change made before a
// reload reaches the cache only through the stored token: the reload cases
// test that pull alone. A write is held in the queue while the tab stays
// online by failing its request at the network, which is what a flaky
// connection does. Run one case with --grep "token · reload".
import { expect, test, type Request, type Route } from "./helpers/live-test";
import { api, openUser, OWNER, setTabOffline, sleep, type Tab } from "./helpers/live-matrix";

const BOOK = "default";
const TOKEN_KEY = `contacts:book:${BOOK}:state`;
const MIRROR_MS = 30_000;

test.use({ actionTimeout: 15_000 });

// --- server -------------------------------------------------------------------------------------

type Call = [string, Record<string, unknown>, string];

async function jmap(methodCalls: Call[]): Promise<Call[]> {
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
    methodCalls,
  });
  if (res.status !== 200) throw new Error(`JMAP ${res.status}: ${JSON.stringify(res.json)}`);
  const responses = (res.json as { methodResponses: Call[] }).methodResponses;
  for (const [method, args] of responses) {
    const failed = args.notCreated ?? args.notUpdated ?? args.notDestroyed;
    if (method === "error" || (failed && Object.keys(failed).length > 0)) {
      throw new Error(`${method}: ${JSON.stringify(args)}`);
    }
  }
  return responses;
}

let accountId = "";

async function contactsAccount(): Promise<string> {
  if (accountId) return accountId;
  const res = await api(OWNER, "GET", "/jmap/session");
  const session = res.json as { primaryAccounts: Record<string, string> };
  accountId = session.primaryAccounts["urn:ietf:params:jmap:contacts"]!;
  return accountId;
}

function cardName(given: string, surname: string) {
  return {
    "@type": "Name",
    full: `${given} ${surname}`,
    components: [
      { "@type": "NameComponent", kind: "given", value: given },
      { "@type": "NameComponent", kind: "surname", value: surname },
    ],
  };
}

/** Cards named `<given> <caseId>` in the default book; returns their ids by first name. */
async function seed(caseId: string, givens: string[]): Promise<Record<string, string>> {
  const create = Object.fromEntries(
    givens.map((given) => [
      given,
      {
        "@type": "Card",
        version: "1.0",
        kind: "individual",
        addressBookIds: { [BOOK]: true },
        name: cardName(given, caseId),
      },
    ]),
  );
  const [[, set]] = await jmap([
    ["ContactCard/set", { accountId: await contactsAccount(), create }, "c"],
  ]);
  const created = set.created as Record<string, { id: string }>;
  return Object.fromEntries(givens.map((given) => [given, created[given]!.id]));
}

async function renameElsewhere(id: string, given: string, caseId: string): Promise<void> {
  await jmap([
    [
      "ContactCard/set",
      { accountId: await contactsAccount(), update: { [id]: { name: cardName(given, caseId) } } },
      "u",
    ],
  ]);
}

async function deleteElsewhere(id: string): Promise<void> {
  await jmap([["ContactCard/set", { accountId: await contactsAccount(), destroy: [id] }, "d"]]);
}

type CardName = { full?: string; components?: { kind: string; value: string }[] };

/** "Given Surname" from the name parts, as the list shows it; `full` when there are none. */
function displayName(name: CardName | undefined): string {
  const parts = name?.components ?? [];
  const given = parts.find((part) => part.kind === "given")?.value ?? "";
  const surname = parts.find((part) => part.kind === "surname")?.value ?? "";
  return given || surname ? `${given} ${surname}`.trim() : (name?.full ?? "");
}

/** The server's cards for this case (the query has no text filter: read the whole book). */
async function serverCards(caseId: string): Promise<{ id: string; name: string }[]> {
  const account = await contactsAccount();
  const [[, query]] = await jmap([
    ["ContactCard/query", { accountId: account, filter: { inAddressBook: BOOK } }, "q"],
  ]);
  const ids = query.ids as string[];
  const found: { id: string; name: string }[] = [];
  // The seeded book is larger than maxObjectsInGet (500): get in chunks.
  for (let i = 0; i < ids.length; i += 500) {
    const [[, got]] = await jmap([
      [
        "ContactCard/get",
        { accountId: account, ids: ids.slice(i, i + 500), properties: ["name"] },
        "g",
      ],
    ]);
    for (const card of got.list as { id: string; name?: CardName }[]) {
      const name = displayName(card.name);
      if (name.includes(caseId)) found.push({ id: card.id, name });
    }
  }
  return found;
}

/** Full names of the server's cards for this case, sorted. */
async function serverNames(caseId: string): Promise<string[]> {
  return (await serverCards(caseId)).map((card) => card.name).sort();
}

async function cleanUp(caseId: string): Promise<void> {
  const ids = (await serverCards(caseId).catch(() => [])).map((card) => card.id);
  if (ids.length === 0) return;
  await jmap([
    ["ContactCard/set", { accountId: await contactsAccount(), destroy: ids }, "d"],
  ]).catch(() => undefined);
}

// --- the tab ------------------------------------------------------------------------------------

type CachedCard = { id: string; name: string; pending: boolean };
type TabCache = { cards: CachedCard[]; outbox: string[]; token: string | null };

/** The tab's Contacts cache, limited to cards that carry `caseId`. */
async function tabCache(tab: Tab, caseId: string): Promise<TabCache> {
  return tab.evaluate(
    async ({ id, tokenKey }) => {
      const user = localStorage.getItem("wgw.offline.contacts.username");
      const empty = { cards: [], outbox: [], token: null };
      if (!user) return empty;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (![...db.objectStoreNames].includes("contacts_cards")) {
        db.close();
        return empty;
      }
      const all = <T>(store: string) =>
        new Promise<T[]>((resolve) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => resolve([]);
        });
      const cards = (
        await all<{ id: string; data: string; pendingSync: boolean }>("contacts_cards")
      )
        .map((row) => {
          const card = JSON.parse(row.data) as {
            name?: { full?: string; components?: { kind: string; value: string }[] };
          };
          const parts = card.name?.components ?? [];
          const given = parts.find((part) => part.kind === "given")?.value ?? "";
          const surname = parts.find((part) => part.kind === "surname")?.value ?? "";
          const name = given || surname ? `${given} ${surname}`.trim() : (card.name?.full ?? "");
          return { id: row.id, name, pending: row.pendingSync };
        })
        .filter((card) => card.name.includes(id))
        .sort((a, b) => a.name.localeCompare(b.name));
      const outbox = (await all<{ domain: string; op: string }>("outbox"))
        .filter((row) => row.domain === "contacts")
        .map((row) => row.op);
      const meta = await all<{ key: string; value: string }>("meta");
      db.close();
      return { cards, outbox, token: meta.find((row) => row.key === tokenKey)?.value ?? null };
    },
    { id: caseId, tokenKey: TOKEN_KEY },
  );
}

/** Overwrite the default book's stored token, as an expired one would be. */
async function setStoredToken(tab: Tab, token: string): Promise<void> {
  await tab.evaluate(
    async ({ value, tokenKey }) => {
      const user = localStorage.getItem("wgw.offline.contacts.username") ?? "";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").put({ key: tokenKey, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { value: token, tokenKey: TOKEN_KEY },
  );
}

const pollCache = (tab: Tab, caseId: string, pick: (cache: TabCache) => unknown, message: string) =>
  expect.poll(async () => pick(await tabCache(tab, caseId)), {
    message,
    timeout: MIRROR_MS,
    intervals: [1_000],
  });

/** The list is ready: the first download is finished, so the tokens exist. */
async function waitForContacts(tab: Tab): Promise<void> {
  await expect(tab.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
    timeout: 60_000,
  });
}

/** Names the list shows for this case (it is windowed over the seeded book: search first). */
async function shownNames(tab: Tab, caseId: string): Promise<string[]> {
  const box = tab.getByPlaceholder("Search contacts...");
  await box.fill("");
  await box.fill(caseId);
  await sleep(1_000);
  const names = await tab
    .getByText(new RegExp(`\\b${caseId}\\b`))
    .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
  return [...new Set(names.filter((name) => /^\S+ \S+$/.test(name)))].sort();
}

async function openContactsTab(context: Awaited<ReturnType<typeof openUser>>): Promise<Tab> {
  const tab = (await context.newPage()) as Tab;
  tab.tag = "A";
  tab.user = OWNER;
  await tab.goto("/contacts/all");
  await waitForContacts(tab);
  return tab;
}

function methodCalls(request: Request): Call[] {
  if (!request.url().endsWith("/jmap") || request.method() !== "POST") return [];
  try {
    return (JSON.parse(request.postData() ?? "{}") as { methodCalls?: Call[] }).methodCalls ?? [];
  } catch {
    return [];
  }
}

/** The tab's `ContactCard/changes` and full book lists since now. */
function watchPulls(tab: Tab) {
  const calls = { sinces: [] as string[], fullLists: 0 };
  // `requestfinished`: an aborted request applies nothing.
  tab.on("requestfinished", (request) => {
    for (const [name, args] of methodCalls(request)) {
      if (name === "ContactCard/changes") calls.sinces.push(String(args.sinceState));
      const filter = args.filter as { inAddressBook?: string } | undefined;
      if (name === "ContactCard/query" && filter?.inAddressBook === BOOK) calls.fullLists += 1;
    }
  });
  return calls;
}

/** Fails every contact write at the network until released, so it stays queued. */
async function holdWrites(tab: Tab): Promise<() => Promise<void>> {
  const handler = (route: Route) =>
    methodCalls(route.request()).some(([name]) => name === "ContactCard/set")
      ? route.abort("failed")
      : route.fallback();
  await tab.route("**/jmap", handler);
  return () => tab.unroute("**/jmap", handler);
}

async function reconnect(tab: Tab): Promise<void> {
  await setTabOffline(tab, true);
  await sleep(1_500);
  await setTabOffline(tab, false);
}

async function reload(tab: Tab): Promise<void> {
  await tab.reload();
  await waitForContacts(tab);
}

/** Edits a card's first name in the open contact form and lets the autosave queue it. */
async function editFirstName(tab: Tab, id: string, given: string): Promise<void> {
  await tab.goto(`/contacts/all/${id}`);
  const field = tab.getByLabel("First name");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(given);
  await sleep(2_500);
}

const conflictDialog = (tab: Tab) => tab.getByRole("dialog", { name: /conflict/i });

/** A case id: letters only, so search and names stay simple. */
function caseId(): string {
  return `Cm${Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("")}`;
}

// --- the matrix ---------------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("contacts inbound", () => {
  test.describe.configure({ timeout: 180_000 });

  for (const via of ["reload", "reconnect"] as const) {
    test(`token · changes elsewhere arrive through the book's token · ${via}`, async ({
      browser,
    }) => {
      const id = caseId();
      const context = await openUser(browser, OWNER);
      try {
        const cards = await seed(id, ["Ann", "Bob", "Cy"]);
        const tab = await openContactsTab(context);
        await pollCache(tab, id, (c) => c.cards.map((card) => card.name), "the tab loads").toEqual([
          `Ann ${id}`,
          `Bob ${id}`,
          `Cy ${id}`,
        ]);
        const before = (await tabCache(tab, id)).token;
        expect(before, "the first download stored the book's token").not.toBeNull();

        if (via === "reconnect") await setTabOffline(tab, true);
        await renameElsewhere(cards.Ann!, "Anna", id);
        await deleteElsewhere(cards.Bob!);
        await seed(id, ["Dee"]);
        const calls = watchPulls(tab);
        if (via === "reload") await reload(tab);
        else {
          await sleep(1_000);
          await setTabOffline(tab, false);
        }

        await pollCache(
          tab,
          id,
          (c) => c.cards.map((card) => card.name),
          "the cache mirrors",
        ).toEqual(await serverNames(id));
        expect(await serverNames(id)).toEqual([`Anna ${id}`, `Cy ${id}`, `Dee ${id}`]);
        expect(calls.sinces, "pulled from the stored token").toContain(before);
        expect(calls.fullLists, "no full list").toBe(0);
        await pollCache(tab, id, (c) => c.token !== before, "the token moved").toBe(true);
        expect(await shownNames(tab, id), "the list shows it").toEqual(await serverNames(id));
      } finally {
        await context.close();
        await cleanUp(id);
      }
    });
  }

  test("full list · an expired token lists the book, drops a card deleted elsewhere, keeps a queued create", async ({
    browser,
  }) => {
    const id = caseId();
    const context = await openUser(browser, OWNER);
    try {
      const cards = await seed(id, ["Ann", "Bob", "Cy"]);
      const tab = await openContactsTab(context);
      await pollCache(tab, id, (c) => c.cards.length, "the tab loads").toBe(3);

      // A create the server never got: queued, with a temporary id.
      const release = await holdWrites(tab);
      await tab.getByRole("button", { name: "New contact", exact: true }).click();
      await tab.getByLabel("First name").fill("New");
      await tab.getByLabel("Last name").fill(id);
      await tab.getByRole("button", { name: "Save", exact: true }).click();
      await pollCache(tab, id, (c) => c.outbox, "the create is queued").toContain("create");

      await deleteElsewhere(cards.Ann!);
      await renameElsewhere(cards.Bob!, "Bobby", id);
      await setStoredToken(tab, "expired");
      const calls = watchPulls(tab);
      await reload(tab);

      await pollCache(
        tab,
        id,
        (c) => c.cards.map((card) => `${card.name}${card.pending ? " (queued)" : ""}`),
        "the full list lands",
      ).toEqual([`Bobby ${id}`, `Cy ${id}`, `New ${id} (queued)`]);
      expect(calls.sinces, "the expired token was tried first").toContain("expired");
      expect(calls.fullLists, "then the book was listed in full").toBeGreaterThan(0);
      const token = (await tabCache(tab, id)).token;
      expect(token, "a fresh token").not.toBe("expired");
      expect(token).not.toBeNull();

      await release();
      await reconnect(tab);
      await expect
        .poll(() => serverNames(id), { message: "the queued create lands", timeout: MIRROR_MS })
        .toEqual([`Bobby ${id}`, `Cy ${id}`, `New ${id}`]);
      await pollCache(
        tab,
        id,
        (c) => c.cards.map((card) => `${card.name}${card.pending ? " (queued)" : ""}`),
        "the tab mirrors the server",
      ).toEqual([`Bobby ${id}`, `Cy ${id}`, `New ${id}`]);
    } finally {
      await context.close();
      await cleanUp(id);
    }
  });

  test("full list · a card edited elsewhere while the book is still listing is not skipped", async ({
    browser,
  }) => {
    const id = caseId();
    const context = await openUser(browser, OWNER);
    let moved: { id: string; name: unknown } | null = null;
    try {
      await seed(id, ["Ann"]);
      const tab = await openContactsTab(context);
      await pollCache(tab, id, (c) => c.cards.length, "the tab loads").toBe(1);
      await setStoredToken(tab, "expired");

      // Let the first explicit-id page through, hold the second.
      let firstIds: string[] | null = null;
      let held: (() => void) | null = null;
      const release = new Promise<void>((resolve) => (held = resolve));
      let isHeld = false;
      const handler = async (route: Route) => {
        const get = methodCalls(route.request()).find(
          ([name, args]) =>
            name === "ContactCard/get" && Array.isArray(args.ids) && args.ids.length > 0,
        );
        if (!get) return route.fallback();
        if (!firstIds) {
          firstIds = get[1].ids as string[];
          return route.fallback();
        }
        isHeld = true;
        await release;
        return route.fallback();
      };
      await tab.route("**/api/v1/jmap", handler);

      await tab.reload();
      await expect.poll(() => isHeld, { message: "a page is held", timeout: 60_000 }).toBe(true);

      // Rename a card from the page that already went through.
      const target = firstIds![0]!;
      const [[, got]] = await jmap([
        [
          "ContactCard/get",
          { accountId: await contactsAccount(), ids: [target], properties: ["name"] },
          "g",
        ],
      ]);
      moved = { id: target, name: (got.list as { name: unknown }[])[0]!.name };
      await renameElsewhere(target, "Moved", id);

      held!();
      await waitForContacts(tab);
      await tab.unroute("**/api/v1/jmap", handler);
      await reconnect(tab);

      await pollCache(
        tab,
        id,
        (c) => c.cards.map((card) => card.name),
        "the tab shows the new name",
      ).toContain(`Moved ${id}`);
      await reload(tab);
      await expect
        .poll(() => shownNames(tab, id), { message: "the list shows it", timeout: MIRROR_MS })
        .toContain(`Moved ${id}`);
    } finally {
      await context.close();
      if (moved) {
        const { id: movedId, name } = moved as { id: string; name: unknown };
        await jmap([
          [
            "ContactCard/set",
            { accountId: await contactsAccount(), update: { [movedId]: { name } } },
            "u",
          ],
        ]).catch(() => undefined);
      }
      await cleanUp(id);
    }
  });

  test("conflict · a queued edit and an edit elsewhere since", async ({ browser }) => {
    const id = caseId();
    const context = await openUser(browser, OWNER);
    try {
      const cards = await seed(id, ["Ann", "Bob"]);
      const tab = await openContactsTab(context);
      await pollCache(tab, id, (c) => c.cards.length, "the tab loads").toBe(2);

      const release = await holdWrites(tab);
      await editFirstName(tab, cards.Ann!, "Mine");
      await pollCache(tab, id, (c) => c.outbox, "the edit is queued").toEqual(["update"]);
      await renameElsewhere(cards.Ann!, "Theirs", id);
      const calls = watchPulls(tab);
      const before = (await tabCache(tab, id)).token;
      await reload(tab);

      await expect(conflictDialog(tab), "the changed card is a conflict").toBeVisible({
        timeout: MIRROR_MS,
      });
      expect(calls.sinces, "found through the stored token").toContain(before);
      const mine = (await tabCache(tab, id)).cards.find((card) => card.id === cards.Ann);
      expect([mine?.name, mine?.pending], "the local edit is kept").toEqual([`Mine ${id}`, true]);

      await release();
      await conflictDialog(tab)
        .getByRole("button", { name: /Keep mine|Apply merged/ })
        .click();
      await expect(conflictDialog(tab)).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(() => serverNames(id), { message: "keep mine lands", timeout: MIRROR_MS })
        .toEqual([`Bob ${id}`, `Mine ${id}`]);
    } finally {
      await context.close();
      await cleanUp(id);
    }
  });

  test("no conflict · a queued edit whose card did not change elsewhere", async ({ browser }) => {
    const id = caseId();
    const context = await openUser(browser, OWNER);
    try {
      const cards = await seed(id, ["Ann", "Bob"]);
      const tab = await openContactsTab(context);
      await pollCache(tab, id, (c) => c.cards.length, "the tab loads").toBe(2);

      const release = await holdWrites(tab);
      await editFirstName(tab, cards.Ann!, "Mine");
      await pollCache(tab, id, (c) => c.outbox, "the edit is queued").toEqual(["update"]);
      // Another card in the same book changes.
      await renameElsewhere(cards.Bob!, "Bobby", id);
      await reload(tab);

      await pollCache(
        tab,
        id,
        (c) => c.cards.map((card) => `${card.name}${card.pending ? " (queued)" : ""}`),
        "the other card's change lands, the queued edit stays",
      ).toEqual([`Bobby ${id}`, `Mine ${id} (queued)`]);
      await sleep(5_000);
      await expect(conflictDialog(tab), "no conflict").toHaveCount(0);

      await release();
      await reconnect(tab);
      await expect
        .poll(() => serverNames(id), { message: "the queued edit lands", timeout: MIRROR_MS })
        .toEqual([`Bobby ${id}`, `Mine ${id}`]);
      await pollCache(tab, id, (c) => c.outbox, "the queue is empty").toEqual([]);
    } finally {
      await context.close();
      await cleanUp(id);
    }
  });
});
