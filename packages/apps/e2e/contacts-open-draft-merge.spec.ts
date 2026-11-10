import { expect, test, type Page, type Request } from "./helpers/live-test";
import { api, OWNER } from "./helpers/live-matrix";

/**
 * The open contact saves itself and takes changes from another tab while it is being
 * edited (#1945 review). Two tabs of one account are open on the same contact:
 *
 * - Tab A adds an empty phone row and types an email; tab B changes the phone. Tab A
 *   shows B's phone, keeps its typing, and saves only the email: B's phone, the title
 *   and the credential stay on the card, and the empty row is not saved.
 * - Tab A types notes; tab B changes the phone again. Both survive a reload of tab A.
 * - Tab A types a letter in the name and deletes it while the save is on its way: the
 *   card ends without the letter.
 * - Tab A reloads while an edit waits for its pause: the form shows what the card holds,
 *   and the contact opened next is not written.
 * - Arrowing through contacts without typing writes nothing.
 */

const BOOK = "default";
const SAVE_BOUND_MS = 15_000;

test.use({ actionTimeout: 15_000 });

type MethodResponse = [string, Record<string, unknown>, string];
type Card = {
  name?: { components?: { kind: string; value: string }[]; full?: string };
  phones?: Record<string, { number: string }>;
  emails?: Record<string, { address: string }>;
  notes?: Record<string, { note: string }>;
};

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

async function getCards(ids: string[]): Promise<Card[]> {
  const [[, got]] = await jmap([["ContactCard/get", { accountId: OWNER, ids }, "g"]]);
  const list = got.list as (Card & { id: string })[];
  return ids.map((id) => list.find((card) => card.id === id)!);
}

const getCard = async (id: string) => (await getCards([id]))[0]!;
const given = (card: Card) => card.name?.components?.find((part) => part.kind === "given")?.value;
const phones = (card: Card) => Object.values(card.phones ?? {}).map((row) => row.number);
const emails = (card: Card) => Object.values(card.emails ?? {}).map((row) => row.address);
const notes = (card: Card) => Object.values(card.notes ?? {}).map((row) => row.note);
const nameParts = (card: Card) =>
  (card.name?.components ?? []).map((part) => `${part.kind}:${part.value}`);

/** A full card: title and credential name parts, one phone, one email. */
function seedCard(surname: string, index: number) {
  return {
    "@type": "Card",
    version: "1.0",
    kind: "individual",
    addressBookIds: { [BOOK]: true },
    name: {
      "@type": "Name",
      components: [
        { "@type": "NameComponent", kind: "title", value: "Dr." },
        { "@type": "NameComponent", kind: "given", value: "Ada" },
        { "@type": "NameComponent", kind: "surname", value: `${surname} ${index}` },
        { "@type": "NameComponent", kind: "credential", value: "PhD" },
      ],
    },
    phones: { p1: { "@type": "Phone", number: `+31 20 000 000${index}` } },
    emails: { e1: { "@type": "EmailAddress", address: `ada${index}@example.org` } },
  };
}

async function seed(surname: string, count: number): Promise<string[]> {
  const create = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`c${index}`, seedCard(surname, index)]),
  );
  const [[, set]] = await jmap([["ContactCard/set", { accountId: OWNER, create }, "c"]]);
  const created = set.created as Record<string, { id: string }>;
  return Array.from({ length: count }, (_, index) => created[`c${index}`]!.id);
}

/** Whether a request is a contact write (`ContactCard/set`) sent by the app. */
function isCardWrite(request: Request): boolean {
  if (!request.url().endsWith("/api/v1/jmap") || request.method() !== "POST") return false;
  const calls = (request.postDataJSON() as { methodCalls?: unknown[][] } | null)?.methodCalls;
  return (calls ?? []).some((call) => call[0] === "ContactCard/set");
}

const firstName = (tab: Page) => tab.locator("#contact-given-name");
const phoneInputs = (tab: Page) => tab.getByRole("textbox", { name: "Phone number" });
const emailInput = (tab: Page) => tab.getByRole("textbox", { name: "Email address" }).first();
const notesInput = (tab: Page) => tab.getByRole("textbox", { name: "Notes" });

async function openContact(tab: Page, id: string): Promise<void> {
  await tab.goto(`/contacts/all/${id}`);
  await expect(firstName(tab)).toHaveValue("Ada", { timeout: 30_000 });
}

/**
 * Types `text` one key at a time, a key every 250 ms (inside the autosave pause), until
 * `done` resolves; returns what was typed. The field keeps the caret throughout.
 */
async function typeUntil(tab: Page, text: string, done: Promise<unknown>): Promise<string> {
  let finished = false;
  void done.then(
    () => (finished = true),
    () => (finished = true),
  );
  let typed = "";
  for (const key of text) {
    if (finished) break;
    await tab.keyboard.type(key);
    typed += key;
    await tab.waitForTimeout(250);
  }
  await done;
  return typed;
}

/** Replaces a field's value as a person does: select all, type the new value. */
async function retype(tab: Page, field: ReturnType<Page["locator"]>, value: string) {
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.pressSequentially(value);
}

test("the open contact merges another tab's change and keeps what is typed", async ({
  context,
}) => {
  test.setTimeout(180_000);
  const run = `Merge${Date.now().toString(36)}`;
  const ids = await seed(run, 4);
  const [id] = ids;
  const tabA = await context.newPage();
  const tabB = await context.newPage();

  try {
    await openContact(tabA, id!);
    await openContact(tabB, id!);

    // 1. A: empty phone row, then an email typed while B changes the phone.
    await tabA.getByRole("button", { name: "Add phone" }).click();
    await expect(phoneInputs(tabA)).toHaveCount(2);
    await emailInput(tabA).click();
    await emailInput(tabA).press("End");
    const bPhone = "+31 20 111 1111";
    const phoneShownInA = expect(phoneInputs(tabA).first()).toHaveValue(bPhone, {
      timeout: SAVE_BOUND_MS * 2,
    });
    const typingInA = typeUntil(tabA, ".typed.slowly.while.another.tab.saves", phoneShownInA);
    await retype(tabB, phoneInputs(tabB).first(), bPhone);
    await expect
      .poll(async () => phones(await getCard(id!)), { timeout: SAVE_BOUND_MS })
      .toEqual([bPhone]);
    const typedEmail = `ada0@example.org${await typingInA}`;

    // A shows B's phone, keeps its empty row and the email as typed.
    await expect(emailInput(tabA)).toHaveValue(typedEmail);
    await expect(phoneInputs(tabA)).toHaveCount(2);
    await expect(phoneInputs(tabA).nth(1)).toHaveValue("");

    // A's save sends its email only: B's phone, the title and the credential stay.
    await expect
      .poll(async () => emails(await getCard(id!)), { timeout: SAVE_BOUND_MS })
      .toEqual([typedEmail]);
    await tabA.waitForTimeout(2_000);
    const afterEmail = await getCard(id!);
    expect(phones(afterEmail)).toEqual([bPhone]);
    expect(nameParts(afterEmail)).toEqual([
      "title:Dr.",
      "given:Ada",
      `surname:${run} 0`,
      "credential:PhD",
    ]);

    // 2. A types notes while B changes the phone again; both survive a reload of A.
    await notesInput(tabA).click();
    const bPhone2 = "+31 20 222 2222";
    const phone2ShownInA = expect(phoneInputs(tabA).first()).toHaveValue(bPhone2, {
      timeout: SAVE_BOUND_MS * 2,
    });
    const typingNotes = typeUntil(tabA, "Typed in tab A while tab B saved", phone2ShownInA);
    await retype(tabB, phoneInputs(tabB).first(), bPhone2);
    const typed = await typingNotes;
    await expect(notesInput(tabA)).toHaveValue(typed);
    // Notes are saved trimmed: a trailing space waits for the next word.
    const typedNotes = typed.trim();
    await expect
      .poll(async () => notes(await getCard(id!)), { timeout: SAVE_BOUND_MS })
      .toEqual([typedNotes]);
    await tabA.reload();
    await expect(firstName(tabA)).toHaveValue("Ada", { timeout: 30_000 });
    await expect(notesInput(tabA)).toHaveValue(typedNotes);
    await expect(phoneInputs(tabA).first()).toHaveValue(bPhone2);
    const afterNotes = await getCard(id!);
    expect(phones(afterNotes)).toEqual([bPhone2]);
    expect(emails(afterNotes)).toEqual([typedEmail]);
    await tabB.close();

    // 3. A letter typed and deleted while its save is on its way leaves no letter.
    let releaseSave: () => void = () => {};
    const saveHeld = new Promise<void>((resolve) => (releaseSave = resolve));
    await tabA.route("**/api/v1/jmap", async (route) => {
      if (isCardWrite(route.request())) await saveHeld;
      await route.continue();
    });
    const saveSent = tabA.waitForRequest(isCardWrite, { timeout: SAVE_BOUND_MS });
    await firstName(tabA).click();
    await firstName(tabA).press("End");
    await tabA.keyboard.type("x");
    await saveSent;
    await tabA.keyboard.press("Backspace");
    await expect(firstName(tabA)).toHaveValue("Ada");
    // The held save lands first ("x" on the card), then the newest draft is saved.
    const heldLanded = tabA.waitForResponse((response) => isCardWrite(response.request()));
    releaseSave();
    await heldLanded;
    await expect
      .poll(async () => given(await getCard(id!)), { timeout: SAVE_BOUND_MS })
      .toBe("Ada");
    await tabA.waitForTimeout(3_000);
    expect(given(await getCard(id!))).toBe("Ada");
    await expect(firstName(tabA)).toHaveValue("Ada");
    await tabA.unrouteAll({ behavior: "wait" });

    // 4. A reload while an edit waits for its pause: the form shows what the card holds,
    // and the contact opened next is not written.
    const nextBefore = await getCard(ids[1]!);
    await notesInput(tabA).click();
    await notesInput(tabA).press("End");
    await tabA.keyboard.type(" pending");
    await tabA.reload();
    await expect(firstName(tabA)).toHaveValue("Ada", { timeout: 30_000 });
    await tabA.waitForTimeout(2_000);
    const reloaded = await getCard(id!);
    await expect(notesInput(tabA)).toHaveValue(notes(reloaded)[0] ?? "");
    await openContact(tabA, ids[1]!);
    await tabA.waitForTimeout(2_000);
    expect(await getCard(ids[1]!)).toEqual(nextBefore);

    // 5. Arrowing through contacts without typing writes nothing.
    const before = await getCards(ids);
    const writes: string[] = [];
    tabA.on("request", (request) => {
      if (isCardWrite(request)) writes.push(request.url());
    });
    const search = tabA.getByPlaceholder("Search contacts...");
    await search.fill(run);
    const rows = tabA.getByRole("heading", { level: 3 });
    await expect(rows).toHaveCount(4);
    await rows.first().click();
    await expect.poll(() => tabA.url()).toContain(ids[0]!);
    for (let step = 0; step < 3; step += 1) {
      const url = tabA.url();
      await tabA.keyboard.press("ArrowDown");
      await expect.poll(() => tabA.url()).not.toBe(url);
      await expect(firstName(tabA)).toHaveValue("Ada");
    }
    await tabA.waitForTimeout(3_000);
    expect(writes).toEqual([]);
    expect(await getCards(ids)).toEqual(before);
  } finally {
    await jmap([["ContactCard/set", { accountId: OWNER, destroy: ids }, "d"]]).catch(
      () => undefined,
    );
  }
});
