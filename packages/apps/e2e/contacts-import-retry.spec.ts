// A vCard import whose first request is created by the server but answered 503
// (a proxy timeout while PHP finishes) is resent in halves. Cards with no UID are keyed
// by the server on their text, so the resend finds them instead of creating them twice.
import { expect, test } from "./helpers/live-test";
import { contactsJmap, destroyContactCards } from "./helpers/contacts-jmap";
import { OWNER } from "./helpers/live-matrix";

const RUN = `Imp${Date.now().toString(36)}`;
const CARD_COUNT = 600;

function vcf(): string {
  return Array.from({ length: CARD_COUNT }, (_, index) => {
    const name = `Retry${String(index).padStart(4, "0")} ${RUN}`;
    const uid = index % 2 === 0 ? "" : `UID:${RUN}-${index}\r\n`;
    return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${name}\r\nN:${RUN};Retry${String(index).padStart(4, "0")};;;\r\n${uid}END:VCARD\r\n`;
  }).join("");
}

/** Ids of this run's cards in the owner's account: the query has no text filter. */
async function runCardIds(): Promise<string[]> {
  const [[, query]] = await contactsJmap([
    ["ContactCard/query", { accountId: OWNER, filter: { inAddressBook: "default" } }, "q"],
  ]);
  const ids = query.ids as string[];
  const found: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const [[, got]] = await contactsJmap([
      [
        "ContactCard/get",
        { accountId: OWNER, ids: ids.slice(i, i + 500), properties: ["name"] },
        "g",
      ],
    ]);
    for (const card of got.list as { id: string; name?: { full?: string } }[]) {
      if (JSON.stringify(card.name ?? {}).includes(RUN)) found.push(card.id);
    }
  }
  return found;
}

test("an import resent after a lost response does not duplicate cards without a UID", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let held = false;
  await page.route("**/contacts/cards/import*", async (route) => {
    if (held) return route.continue();
    held = true;
    await route.fetch();
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  try {
    await page.goto("/contacts/all");
    await expect(page.locator("[data-list-item-id]").first()).toBeVisible();
    // The API operations attach after the first sync; an earlier pick only toasts an error.
    await expect(async () => {
      await page.locator('input[type="file"]').setInputFiles({
        name: "retry.vcf",
        mimeType: "text/vcard",
        buffer: Buffer.from(vcf()),
      });
      await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Import", exact: true }).click();

    await expect(page.getByText(`Imported ${CARD_COUNT} contacts`)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);

    await page.reload();
    expect(await runCardIds()).toHaveLength(CARD_COUNT);
  } finally {
    await destroyContactCards(await runCardIds().catch(() => []));
  }
});
