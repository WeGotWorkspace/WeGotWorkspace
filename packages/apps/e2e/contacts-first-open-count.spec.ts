// Contacts first open (live app, #1745). A browser without a local copy
// downloads the address book 40 cards per request and paints after each page.
// The All Contacts header must show the number of contacts (groups left out)
// from the first paint on, not the rows loaded so far.
import { expect, test, type Page } from "./helpers/live-test";
import {
  CONTACTS_E2E_USER as USER,
  contactsJmap as jmap,
  createContactCards,
  destroyContactCards,
} from "./helpers/contacts-jmap";

/** More than two card pages, so the header is painted while pages are missing. */
const SEEDED_CONTACTS = 100;
/** Slows each JMAP request so every page is painted on its own. */
const REQUEST_DELAY_MS = 150;

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
  const cards = Array.from({ length: SEEDED_CONTACTS }, (_, index) =>
    card(`e2e-count-${stamp}-${index}`, "individual"),
  );
  return createContactCards([...cards, card(`e2e-count-group-${stamp}`, "group")]);
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
    await destroyContactCards(created.splice(0));
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
