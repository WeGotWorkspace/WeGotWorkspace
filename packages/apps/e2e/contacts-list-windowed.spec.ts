// The Contacts list mounts only the rows near the viewport once it has more than
// 80 (#1641 step d, on the shared WorkspaceList). Keyboard navigation, the sticky
// letter header and opening a far contact from its link must work as before.
import { expect, test, type Page } from "./helpers/live-test";
import { createContactCards, destroyContactCards } from "./helpers/contacts-jmap";

const RUN = Date.now().toString(36);
/** One surname: every card sorts into the same letter section, by given name. */
const SURNAME = `Window${RUN}`;
const CARD_COUNT = 120;
const ROW = "[data-list-item-id]";

const list = (page: Page) => page.locator("[data-workspace-list-rows]");

function card(index: number) {
  const given = `Row${String(index + 1).padStart(3, "0")}`;
  return {
    "@type": "Card",
    version: "1.0",
    kind: "individual",
    addressBookIds: { default: true },
    name: {
      "@type": "Name",
      full: `${given} ${SURNAME}`,
      components: [
        { kind: "given", value: given },
        { kind: "surname", value: SURNAME },
      ],
    },
  };
}

/**
 * The selected row's id and whether it sits fully inside the scrollport. A
 * contact opened from its link is the active row (`data-active`) instead.
 */
async function selectedRow(page: Page, state: "selected" | "active" = "selected") {
  return page.evaluate(
    ({ rowSelector, state }) => {
      const row = document.querySelector<HTMLElement>(`${rowSelector}[data-${state}="true"]`);
      const scroller = row?.closest<HTMLElement>(".overflow-y-auto");
      if (!row || !scroller) return { id: null, inView: false };
      const box = row.getBoundingClientRect();
      const port = scroller.getBoundingClientRect();
      return {
        id: row.getAttribute("data-list-item-id"),
        inView: box.top >= port.top - 1 && box.bottom <= port.bottom + 1,
      };
    },
    { rowSelector: ROW, state },
  );
}

async function focusedRowId(page: Page): Promise<string | null> {
  return page.evaluate(
    (rowSelector) =>
      document.activeElement?.closest(rowSelector)?.getAttribute("data-list-item-id") ?? null,
    ROW,
  );
}

/** The letter header stuck to the top of the scrollport, if any. */
async function stuckHeader(page: Page): Promise<string | null> {
  return page.evaluate((rowSelector) => {
    const scroller = document.querySelector(rowSelector)?.closest(".overflow-y-auto");
    if (!scroller) return null;
    const top = scroller.getBoundingClientRect().top;
    for (const header of scroller.querySelectorAll<HTMLElement>(".list-sticky-header")) {
      if (Math.abs(header.getBoundingClientRect().top - top) <= 1) return header.id;
    }
    return null;
  }, ROW);
}

test.describe("Contacts list with more than 80 contacts", () => {
  const created: string[] = [];

  test.afterEach(async () => {
    await destroyContactCards(created.splice(0));
  });

  test("arrow keys walk past the window, the header sticks, a far link opens in view", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    created.push(
      ...(await createContactCards(Array.from({ length: CARD_COUNT }, (_, i) => card(i)))),
    );

    await page.goto("/contacts");
    await expect(page.locator(ROW).first()).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Search contacts...").fill(SURNAME);
    // 120 cards under one letter header.
    await expect(list(page)).toHaveAttribute("data-workspace-list-rows", String(CARD_COUNT + 1), {
      timeout: 60_000,
    });
    const mounted = Number(await list(page).getAttribute("data-workspace-list-mounted"));
    expect(mounted).toBeGreaterThan(3);
    expect(mounted).toBeLessThan(40);

    // ↓ sixty times: the selection walks out of the first window and stays in view.
    const first = page.locator(ROW).first();
    await first.click();
    const firstId = await first.getAttribute("data-list-item-id");
    await first.focus();
    for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await selectedRow(page)).inView).toBe(true);
    const far = await selectedRow(page);
    expect(far.id).not.toBe(firstId);
    expect(far.id).toBe(created[60]);
    await expect(page).toHaveURL(new RegExp(`${far.id}$`));
    expect(await focusedRowId(page)).toBe(firstId);
    // Mid-section, the section's letter header is stuck at the top.
    expect(await stuckHeader(page)).toBe("contacts-section-W");

    // ↑ back to the top.
    for (let step = 0; step < 60; step += 1) await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await selectedRow(page)).id).toBe(firstId);
    expect((await selectedRow(page)).inView).toBe(true);

    // Open a far contact from its link in a fresh page: the list scrolls it into view.
    const target = created[110]!;
    await page.goto(`/contacts/all/${target}`);
    await expect(page.locator(ROW).first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => selectedRow(page, "active"), { timeout: 30_000 })
      .toEqual({
        id: target,
        inView: true,
      });
  });
});
