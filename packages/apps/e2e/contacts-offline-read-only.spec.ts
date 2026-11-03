// A queued Contacts edit that the server refuses on reconnect (#1887).
//
// The teammate edits a shared card offline. While they are offline, the owner
// makes the share view-only. On reconnect the server answers `forbidden`: the
// edit must stay in the outbox as a permanent failure, not be replaced by the
// server copy. The tab keeps the offline name, the failed-sync notice lists it,
// and a reload keeps both. The server card is unchanged.
//
// Only the update is played here: the UI offers no new contact in a book
// shared with you (`canCreateContactInAddressBook`), so a refused create is
// covered by the flush unit tests.
import { expect, test } from "./helpers/live-test";
import { api, openUser, OWNER, setTabOffline, TEAMMATE, type Tab } from "./helpers/live-matrix";

const RUN = Date.now().toString(36);
const GIVEN = `Ro${RUN}`;
const SURNAME = "Card";
const ORIGINAL = `${GIVEN} ${SURNAME}`;
const OFFLINE_GIVEN = `${GIVEN}Off`;
const OFFLINE = `${OFFLINE_GIVEN} ${SURNAME}`;

/** The list is windowed over ~1000 seeded contacts: narrow it to this run's card. */
async function search(tab: Tab): Promise<void> {
  // The refresh button stays busy until the first download is finished.
  await expect(tab.getByRole("button", { name: "Refresh contacts" })).toBeEnabled({
    timeout: 60_000,
  });
  const box = tab.getByPlaceholder("Search contacts...");
  await box.fill("");
  await box.fill(GIVEN);
}

type Call = [string, Record<string, unknown>, string];

async function jmap(
  methodCalls: Call[],
): Promise<Array<[string, Record<string, unknown>, string]>> {
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
    methodCalls,
  });
  if (res.status !== 200) throw new Error(`JMAP ${res.status}: ${JSON.stringify(res.json)}`);
  return (res.json as { methodResponses: never }).methodResponses;
}

async function ownerAccountId(): Promise<string> {
  const res = await api(OWNER, "GET", "/jmap/session");
  const session = res.json as { primaryAccounts: Record<string, string> };
  return session.primaryAccounts["urn:ietf:params:jmap:contacts"]!;
}

test.describe("Contacts edit refused because the book became read-only", () => {
  let accountId = "";
  let cardId = "";

  async function shareBook(mayWrite: boolean): Promise<void> {
    const [[, set]] = await jmap([
      [
        "AddressBook/set",
        {
          accountId,
          update: { default: { shareWith: { [TEAMMATE]: { mayRead: true, mayWrite } } } },
        },
        "s",
      ],
    ]);
    expect(Object.keys((set.notUpdated as object) ?? {}), "share update").toEqual([]);
  }

  async function serverName(): Promise<string | undefined> {
    const [[, got]] = await jmap([
      ["ContactCard/get", { accountId, ids: [cardId], properties: ["name"] }, "g"],
    ]);
    const list = got.list as Array<{ name?: { full?: string } }>;
    return list[0]?.name?.full;
  }

  test.beforeAll(async () => {
    accountId = await ownerAccountId();
    const [[, set]] = await jmap([
      [
        "ContactCard/set",
        {
          accountId,
          create: {
            c: {
              "@type": "Card",
              version: "1.0",
              addressBookIds: { default: true },
              name: { "@type": "Name", full: ORIGINAL },
            },
          },
        },
        "c",
      ],
    ]);
    const created = set.created as Record<string, { id: string }> | undefined;
    cardId = created?.c?.id ?? "";
    if (!cardId) throw new Error(`Seeding failed: ${JSON.stringify(set.notCreated)}`);
    await shareBook(true);
  });

  test.afterAll(async () => {
    await jmap([
      [
        "AddressBook/set",
        { accountId, update: { default: { shareWith: { [TEAMMATE]: null } } } },
        "u",
      ],
    ]).catch(() => undefined);
    if (cardId) {
      await jmap([["ContactCard/set", { accountId, destroy: [cardId] }, "d"]]).catch(
        () => undefined,
      );
    }
  });

  test("the offline edit stays, the notice lists it, and a reload keeps both", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const context = await openUser(browser, TEAMMATE);
    try {
      const tab = (await context.newPage()) as Tab;
      await tab.goto("/contacts/all");
      await search(tab);
      await expect(tab.getByText(ORIGINAL, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // Offline edit of the shared card.
      await tab.getByText(ORIGINAL, { exact: true }).first().click();
      await setTabOffline(tab, true);
      await tab.getByRole("button", { name: "Edit", exact: true }).click();
      await tab.getByLabel("First name").fill(OFFLINE_GIVEN);
      await expect(tab.getByText(OFFLINE, { exact: true }).first()).toBeVisible();
      // Let the debounced autosave queue the edit, then leave edit mode.
      await tab.waitForTimeout(1_500);
      await tab.getByRole("button", { name: "Edit", exact: true }).click();

      // The owner makes the share view-only; the teammate reconnects.
      await shareBook(false);
      await setTabOffline(tab, false);

      const notice = tab.getByText("Some changes couldn’t sync").first();
      await expect(notice).toBeVisible({ timeout: 60_000 });
      await expect(tab.getByText(OFFLINE, { exact: true }).first()).toBeVisible();
      await expect(tab.getByLabel(/conflict resolution/)).toHaveCount(0);
      expect(await serverName(), "the refused edit did not land").toBe(ORIGINAL);

      // A reload keeps the edit and the notice: it is a permanent failure.
      await tab.reload();
      await search(tab);
      await expect(tab.getByText(OFFLINE, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(notice).toBeVisible({ timeout: 60_000 });
      expect(await serverName()).toBe(ORIGINAL);
    } finally {
      await context.close();
    }
  });
});
