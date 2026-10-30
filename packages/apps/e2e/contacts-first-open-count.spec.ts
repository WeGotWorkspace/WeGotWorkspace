// Contacts first open (live app, #1745). A browser without a local copy
// downloads the address book 40 cards per request and paints after each page.
// The All Contacts header must show the number of contacts (groups left out)
// from the first paint on, not the rows loaded so far.
import { expect, test, type Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const USER = process.env.WGW_E2E_USERNAME ?? "admin";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"];

/** More than two card pages, so the header is painted while pages are missing. */
const SEEDED_CONTACTS = 100;
/** Slows each JMAP request so every page is painted on its own. */
const REQUEST_DELAY_MS = 150;

type Invocation = [string, Record<string, unknown>, string];

let accessToken: string | null = null;

async function token(): Promise<string> {
  if (accessToken) return accessToken;
  const res = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login ${USER} failed: ${res.status}`);
  accessToken = ((await res.json()) as { access_token: string }).access_token;
  return accessToken;
}

/** The other client: same user, straight to the JMAP API. */
async function jmap(methodCalls: Invocation[]): Promise<Invocation[]> {
  const res = await fetch(`${API}/api/v1/jmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  if (!res.ok) throw new Error(`JMAP failed: ${res.status}`);
  return ((await res.json()) as { methodResponses: Invocation[] }).methodResponses;
}

function card(full: string, kind: "individual" | "group") {
  return {
    "@type": "Card",
    version: "1.0",
    kind,
    addressBookIds: { default: true },
    name: { "@type": "Name", full },
  };
}

async function seedContactsAndGroup(stamp: number): Promise<string[]> {
  const create: Record<string, unknown> = {};
  for (let index = 0; index < SEEDED_CONTACTS; index += 1) {
    create[`p${index}`] = card(`e2e-count-${stamp}-${index}`, "individual");
  }
  create.group = card(`e2e-count-group-${stamp}`, "group");
  const [[, result]] = await jmap([["ContactCard/set", { accountId: USER, create }, "s0"]]);
  const created = (result.created ?? {}) as Record<string, { id: string }>;
  const ids = Object.values(created).map((entry) => entry.id);
  if (ids.length !== SEEDED_CONTACTS + 1) {
    throw new Error(`Seeded ${ids.length} cards: ${JSON.stringify(result.notCreated)}`);
  }
  return ids;
}

/** Every card that is not a group: what All Contacts shows once loaded. */
async function contactTotal(): Promise<number> {
  const [[, all], [, groups]] = await jmap([
    ["ContactCard/query", { accountId: USER }, "q0"],
    ["ContactCard/query", { accountId: USER, filter: { kind: "group" } }, "q1"],
  ]);
  return (all.ids as string[]).length - (groups.ids as string[]).length;
}

/** Records each value the header count takes, from the first paint on. */
async function recordHeaderCounts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __headerCounts: string[] }).__headerCounts = seen;
    const record = () => {
      const text = document.querySelector(".view-header__title-count")?.textContent ?? null;
      if (text !== null && seen[seen.length - 1] !== text) seen.push(text);
    };
    new MutationObserver(record).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

test.describe("Contacts first open (live app)", () => {
  const created: string[] = [];

  test.afterEach(async () => {
    const destroy = created.splice(0);
    if (destroy.length > 0) {
      await jmap([["ContactCard/set", { accountId: USER, destroy }, "d0"]]).catch(() => undefined);
    }
  });

  test("the All Contacts header shows the contact total during the whole download", async ({
    page,
  }) => {
    created.push(...(await seedContactsAndGroup(Date.now())));
    const expected = `(${await contactTotal()})`;

    let cardPages = 0;
    await page.route("**/api/v1/jmap", async (route) => {
      if (route.request().postData()?.includes('"ContactCard/get"')) cardPages += 1;
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      await route.continue();
    });
    await recordHeaderCounts(page);

    await page.goto("/contacts");
    await expect(page.locator(".view-header__title-count")).toHaveText(expected, {
      timeout: 60_000,
    });
    // The refresh button stays busy until the last page is in.
    await expect(page.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
      timeout: 60_000,
    });

    // First request (books, ids, empty get) plus at least three card pages.
    expect(cardPages).toBeGreaterThanOrEqual(4);
    const counts = await page.evaluate(
      () => (window as unknown as { __headerCounts: string[] }).__headerCounts,
    );
    // "(0)" is the loading spinner, before any card arrived.
    expect(counts.filter((value) => value !== "(0)")).toEqual([expected]);
  });
});
