// Notes recovery after cannotCalculateChanges with more than 500 notes (live app, #1792).
//
// When the server cannot calculate changes (an expired state), the inbound
// poll re-lists every note. One Note/get for all ids failed with
// requestTooLarge above maxObjectsInGet (500), so the list never caught up and
// every poll logged a warning. The re-list must chunk the ids.
import { expect, test, type Page } from "./helpers/live-test";
import { E2E_NOTEBOOK_ID, waitForNotesListReady } from "./helpers/notes-live";

const RUN = Date.now().toString(36);
const NOTE_COUNT = 520;
const NEW_TITLE = `Relist new ${RUN}`;

/** Create notes through REST in the page. Retries a 429 so seeding never flakes on the budget. */
async function createNotes(page: Page, titles: string[]): Promise<void> {
  await page.evaluate(
    async ({ titles, notebookId }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const create = async (title: string): Promise<void> => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const response = await fetch("/api/v1/notes/items", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uid: crypto.randomUUID(),
              notebookId,
              title,
              body: title,
              categories: [],
            }),
          });
          if (response.status === 429) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          if (!response.ok) {
            throw new Error(`Seed note failed (${response.status}): ${await response.text()}`);
          }
          return;
        }
        throw new Error("Seed note stayed rate limited");
      };
      for (let at = 0; at < titles.length; at += 8) {
        await Promise.all(titles.slice(at, at + 8).map(create));
      }
    },
    { titles, notebookId: E2E_NOTEBOOK_ID },
  );
}

type JmapCall = [string, Record<string, unknown>, string];

function parseCalls(postData: string | null): JmapCall[] {
  try {
    return (JSON.parse(postData ?? "{}") as { methodCalls?: JmapCall[] }).methodCalls ?? [];
  } catch {
    return [];
  }
}

test.describe("Notes re-list with more than 500 notes", () => {
  test("recovers from cannotCalculateChanges and shows a new note", async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto("/notes");
    await expect(page.getByRole("button", { name: "New note" })).toBeVisible({ timeout: 30_000 });
    await createNotes(
      page,
      Array.from(
        { length: NOTE_COUNT },
        (_, i) => `Relist ${RUN} ${String(i + 1).padStart(3, "0")}`,
      ),
    );

    // Tab A: opens with the seeded notes and watches its own JMAP traffic.
    const warnings: string[] = [];
    let noteChanges = 0;
    const nullIdGets: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        warnings.push(message.text());
      }
    });
    page.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
      for (const [name, args] of parseCalls(request.postData())) {
        if (name === "Note/changes") noteChanges += 1;
        if (name === "Note/get" && args.ids === null) nullIdGets.push(request.postData() ?? "");
      }
    });

    await page.reload();
    await waitForNotesListReady(page);
    await expect(page.locator(".list-item__button").first()).toBeVisible({ timeout: 30_000 });
    // The live poll is running once it has asked for Note/changes.
    await expect.poll(() => noteChanges, { timeout: 60_000 }).toBeGreaterThan(0);

    // The next Note/changes carries a state the server cannot calculate from, once.
    let rewritten = false;
    await page.route("**/api/v1/jmap", async (route) => {
      const request = route.request();
      const body = request.postData();
      if (rewritten || request.method() !== "POST" || !body) return route.continue();
      const parsed = JSON.parse(body) as { methodCalls?: JmapCall[] };
      const calls = parsed.methodCalls ?? [];
      if (!calls.some(([name]) => name === "Note/changes")) return route.continue();
      rewritten = true;
      for (const [name, args] of calls) {
        if (name === "Note/changes") args.sinceState = "bogus";
      }
      return route.continue({ postData: JSON.stringify(parsed) });
    });
    await expect.poll(() => rewritten, { timeout: 60_000 }).toBe(true);

    // Tab B, same account: a new note while tab A recovers.
    const other = await page.context().newPage();
    try {
      await other.goto("/notes");
      await expect(other.getByRole("button", { name: "New note" })).toBeVisible({
        timeout: 30_000,
      });
      await createNotes(other, [NEW_TITLE]);
    } finally {
      await other.close();
    }

    // No reload in tab A: the poll re-lists and the note shows up.
    await page.getByPlaceholder("Search notes...").fill(NEW_TITLE);
    await expect(page.locator(".list-item__button").filter({ hasText: NEW_TITLE })).toBeVisible({
      timeout: 60_000,
    });

    expect(warnings.filter((text) => text.includes("requestTooLarge"))).toEqual([]);
    expect(warnings.filter((text) => text.includes("[notes] live inbound poll failed"))).toEqual(
      [],
    );
    expect(nullIdGets).toEqual([]);
  });
});
