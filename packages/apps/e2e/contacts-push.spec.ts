import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #1666: contacts the owner changes in an address book shared with a teammate
 * reach the teammate's open Contacts tab on push: create, rename and delete
 * over JMAP, the same three from a CardDAV client, and again after the tab
 * reloads.
 *
 * Bound: 8 s, well inside the 10 s inbound poll. While push is connected the
 * fallback poll runs every 60 s, and each phase runs well within 60 s of push
 * connecting, so a pass proves the push path. Every write comes from the
 * owner over the API, so no tab of the teammate sees it first, and only after
 * the tab's first download is done (see `inboundReady`).
 */

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const PUSH_BOUND_MS = 8_000;
/** The owner's personal book: the one book CardDAV and JMAP both reach. */
const BOOK = "default";

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("the owner's contact changes in a shared book reach the teammate's open tab on push", async ({
  browser,
}) => {
  const run = `push${Date.now().toString(36)}`;
  const id = `Aa ${run}`;
  const cardIds: string[] = [];
  const davUid = `${run}-dav`;
  let context: BrowserContext | null = null;

  try {
    await share({ [TEAMMATE]: { mayRead: true, mayWrite: true } });
    const [renameId, removeId] = await createCards([`${id} rename`, `${id} delete`]);
    cardIds.push(renameId!, removeId!);

    context = await openUser(browser, TEAMMATE);
    const connected = pushConnected(context);
    const tab = await context.newPage();
    const ready = inboundReady(tab);
    await tab.goto("/contacts/all");
    await searchFor(tab, run);
    await Promise.all([connected, ready]);
    await expect(name(tab, `${id} rename`)).toBeVisible();
    await expect(name(tab, `${id} delete`)).toBeVisible();

    // JMAP: create, rename, delete.
    let sentAt = Date.now();
    cardIds.push(...(await createCards([`${id} created`])));
    await jmap([
      [
        "ContactCard/set",
        { accountId: OWNER, update: { [renameId!]: { name: { full: `${id} renamed` } } } },
        "u",
      ],
    ]);
    await jmap([["ContactCard/set", { accountId: OWNER, destroy: [removeId!] }, "d"]]);
    await expect(name(tab, `${id} created`)).toBeVisible({ timeout: left(sentAt) });
    await expect(name(tab, `${id} renamed`)).toBeVisible({ timeout: left(sentAt) });
    await expect(name(tab, `${id} rename`)).toHaveCount(0, { timeout: left(sentAt) });
    await expect(name(tab, `${id} delete`)).toHaveCount(0, { timeout: left(sentAt) });
    const jmapMs = Date.now() - sentAt;

    // CardDAV: create, edit, then delete in a second round.
    sentAt = Date.now();
    await dav("PUT", davUid, vcard(davUid, `${id} dav`));
    await expect(name(tab, `${id} dav`)).toBeVisible({ timeout: left(sentAt) });
    await dav("PUT", davUid, vcard(davUid, `${id} dav edited`));
    await expect(name(tab, `${id} dav edited`)).toBeVisible({ timeout: left(sentAt) });
    const davMs = Date.now() - sentAt;
    sentAt = Date.now();
    await dav("DELETE", davUid);
    await expect(name(tab, `${id} dav edited`)).toHaveCount(0, { timeout: left(sentAt) });

    // After a reload the stream must connect again and carry the next change.
    const reconnected = pushConnected(context);
    const readyAgain = inboundReady(tab);
    await tab.reload();
    await searchFor(tab, run);
    await Promise.all([reconnected, readyAgain]);
    await expect(name(tab, `${id} renamed`)).toBeVisible();
    sentAt = Date.now();
    cardIds.push(...(await createCards([`${id} after reload`])));
    await expect(name(tab, `${id} after reload`)).toBeVisible({ timeout: left(sentAt) });
    const reloadMs = Date.now() - sentAt;

    for (const [label, ms] of [
      ["jmap", jmapMs],
      ["carddav", davMs],
      ["after reload", reloadMs],
    ] as const) {
      test.info().annotations.push({ type: "latency", description: `${label}: ${ms} ms` });
    }
    console.log(
      `[contacts-push] owner edits → teammate tab: jmap ${jmapMs} ms, carddav ${davMs} ms, after reload ${reloadMs} ms`,
    );
  } finally {
    await context?.close();
    await dav("DELETE", davUid).catch(() => undefined);
    if (cardIds.length) {
      await jmap([["ContactCard/set", { accountId: OWNER, destroy: cardIds }, "d"]]).catch(
        () => undefined,
      );
    }
    await share({ [TEAMMATE]: null }).catch(() => undefined);
  }
});

const left = (sentAt: number) => Math.max(1, PUSH_BOUND_MS - (Date.now() - sentAt));

/**
 * The list is long and windowed: show only this run's cards. A search typed
 * while the list still loads can be dropped, so it retries until it filters.
 */
async function searchFor(tab: Page, text: string): Promise<void> {
  const box = tab.getByPlaceholder("Search contacts...");
  await expect(async () => {
    await box.fill(text);
    await expect(tab.getByRole("heading", { level: 3 }).first()).toContainText(text, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

function name(tab: Page, text: string) {
  return tab.getByRole("heading", { level: 3, name: text, exact: true });
}

type MethodResponse = [string, Record<string, unknown>, string];

async function jmap(methodCalls: unknown[]): Promise<MethodResponse[]> {
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
    methodCalls,
  });
  if (res.status !== 200) throw new Error(`JMAP ${res.status}: ${JSON.stringify(res.json)}`);
  const responses = (res.json as { methodResponses: MethodResponse[] }).methodResponses;
  for (const [method, args] of responses) {
    const failed = args.notCreated ?? args.notUpdated ?? args.notDestroyed;
    if (method === "error" || (failed && Object.keys(failed).length > 0)) {
      throw new Error(`${method}: ${JSON.stringify(args)}`);
    }
  }
  return responses;
}

async function share(shareWith: Record<string, unknown>): Promise<void> {
  await jmap([["AddressBook/set", { accountId: OWNER, update: { [BOOK]: { shareWith } } }, "s"]]);
}

/** Creates cards in the shared book and returns their ids, in order. */
async function createCards(names: string[]): Promise<string[]> {
  const create = Object.fromEntries(
    names.map((full, index) => [
      `c${index}`,
      {
        "@type": "Card",
        version: "1.0",
        addressBookIds: { [BOOK]: true },
        name: { "@type": "Name", full },
      },
    ]),
  );
  const [[, set]] = await jmap([["ContactCard/set", { accountId: OWNER, create }, "c"]]);
  const created = set.created as Record<string, { id: string }>;
  return names.map((_, index) => created[`c${index}`]!.id);
}

/** A write from a CardDAV client: Basic auth on the owner's book. */
async function dav(method: "PUT" | "DELETE", uid: string, body?: string): Promise<void> {
  const res = await fetch(`${API}/addressbooks/${OWNER}/${BOOK}/${uid}.vcf`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${OWNER}:${PASSWORD}`).toString("base64")}`,
      "Content-Type": "text/vcard; charset=utf-8",
    },
    body,
  });
  if (!res.ok) throw new Error(`CardDAV ${method} ${res.status}: ${await res.text()}`);
}

function vcard(uid: string, full: string): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `UID:${uid}`,
    `FN:${full}`,
    `N:${full};;;;`,
    "END:VCARD",
    "",
  ].join("\r\n");
}

/**
 * Resolves once the live inbound sync runs and the first download and its
 * catch-up refresh are done. Its first call is a lone `ContactCard/get` with
 * no ids (the first download asks for ids). A write before that lands through
 * the catch-up refresh instead of push, so the spec would prove nothing.
 */
async function inboundReady(tab: Page): Promise<void> {
  let lastRequest = Date.now();
  const onRequest = (request: { url: () => string }) => {
    if (request.url().endsWith("/api/v1/jmap")) lastRequest = Date.now();
  };
  tab.on("request", onRequest);
  try {
    await tab.waitForResponse(
      (response) => {
        if (!response.url().endsWith("/api/v1/jmap")) return false;
        const calls = (response.request().postDataJSON() as { methodCalls?: unknown[][] } | null)
          ?.methodCalls;
        const [method, args] = (calls?.length === 1 ? calls[0] : []) as [
          string?,
          { ids?: unknown[] }?,
        ];
        return method === "ContactCard/get" && args?.ids?.length === 0;
      },
      { timeout: 60_000 },
    );
    await expect.poll(() => Date.now() - lastRequest, { timeout: 30_000 }).toBeGreaterThan(1_000);
  } finally {
    tab.off("request", onRequest);
  }
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
