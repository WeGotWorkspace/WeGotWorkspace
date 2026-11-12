// Notes recovery after cannotCalculateChanges with more than 500 notes (live app, #1792).
//
// When the server cannot calculate changes (an expired state), the inbound
// poll re-lists every note. One Note/get for all ids failed with
// requestTooLarge above maxObjectsInGet (500), so the list never caught up and
// every poll logged a warning. The re-list must chunk the ids.
import { expect, resetApiBudgetAfterSetup, test } from "./helpers/live-test";
import { waitForNotesListReady } from "./helpers/notes-live";
import { createNotes, deleteNotes } from "./helpers/notes-rest";

const RUN = Date.now().toString(36);
const NOTE_COUNT = 520;
const NEW_TITLE = `Relist new ${RUN}`;

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
    const created: string[] = [];
    try {
      await createNotes(
        page,
        Array.from(
          { length: NOTE_COUNT },
          (_, i) => `Relist ${RUN} ${String(i + 1).padStart(3, "0")}`,
        ),
        created,
      );
      // The seed spent most of the minute's budget; the scenario below gets its own.
      resetApiBudgetAfterSetup();

      // Tab A: opens with the seeded notes and watches its own JMAP traffic.
      const warnings: string[] = [];
      let pushPolls = 0;
      let rewritten = false;
      let queriesAfterRewrite = 0;
      const nullIdGets: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
          warnings.push(message.text());
        }
      });
      page.on("request", (request) => {
        if (request.url().includes("/api/v1/jmap/events/")) pushPolls += 1;
        if (request.method() !== "POST" || !request.url().endsWith("/api/v1/jmap")) return;
        for (const [name, args] of parseCalls(request.postData())) {
          if (name === "Note/query" && rewritten) queriesAfterRewrite += 1;
          if (name === "Note/get" && args.ids === null) nullIdGets.push(request.postData() ?? "");
        }
      });

      await page.reload();
      await waitForNotesListReady(page);
      await expect(page.locator(".list-item__button").first()).toBeVisible({ timeout: 30_000 });
      // Tab A asks for Note/changes only after a push says the state moved, so wait for the push channel.
      await expect.poll(() => pushPolls, { timeout: 60_000 }).toBeGreaterThan(0);

      // The next Note/changes carries a state the server cannot calculate from, once.
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

      // Another client on the same account creates a note over REST. Its push makes
      // tab A ask for Note/changes. (A second tab would share tab A's sync and could
      // send that Note/changes itself, past this tab's route.)
      await createNotes(page, [NEW_TITLE], created);
      await expect.poll(() => rewritten, { timeout: 60_000 }).toBe(true);

      // No reload in tab A: the poll re-lists and the note shows up.
      await page.getByPlaceholder("Search notes...").fill(NEW_TITLE);
      await expect(page.locator(".list-item__button").filter({ hasText: NEW_TITLE })).toBeVisible({
        timeout: 60_000,
      });

      expect(warnings.filter((text) => text.includes("requestTooLarge"))).toEqual([]);
      expect(warnings.filter((text) => text.includes("[notes] live inbound sync"))).toEqual([]);
      expect(nullIdGets).toEqual([]);
      // The note did not just arrive through a later plain poll: tab A re-listed by query.
      expect(queriesAfterRewrite).toBeGreaterThan(0);
    } finally {
      await page.unroute("**/api/v1/jmap");
      await deleteNotes(page, created);
      resetApiBudgetAfterSetup();
    }
  });
});
