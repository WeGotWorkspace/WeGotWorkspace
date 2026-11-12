// Undo as a compensating write, seen by someone else (#1854).
//
// A change reaches the server right away (before #1854 it waited 2.5 s behind the Undo
// toast). Undo is a second change, which the other person gets too. Owner A acts; B is the
// teammate on the shared notebook, or the owner's second browser for the star (a star is
// per person).
//
// Timeline per case: A acts → the server has it within `LANDED_WITHIN_MS` → A presses Undo
// while the toast is still up → the server has the revert → B ends on the reverted state.
// B is watched the whole time, so the spec also records whether B saw the change before the
// revert; how soon B sees anything depends on the push round (#1659), not on this change.
import { expect, test, type BrowserContext } from "./helpers/live-test";
import {
  api,
  ensureTeamNotebook,
  listTitles,
  moveTo,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK_NAME,
  serverNote,
  sleep,
  TEAM_NOTEBOOK,
  TEAM_NOTEBOOK_NAME,
  TEAMMATE,
  type ServerNote,
  type Tab,
} from "./helpers/notes-matrix";

/** Sent at once: well under the old 2.5 s grace period. */
const LANDED_WITHIN_MS = Number(process.env.WGW_E2E_LANDED_WITHIN_MS ?? 2_000);
/** The toast offers Undo for 6 s; press it with room to spare. */
const UNDO_AFTER_MS = Number(process.env.WGW_E2E_UNDO_AFTER_MS ?? 4_000);
/** One push round plus a sync on a busy local server. */
const B_SETTLES_WITHIN_MS = Number(process.env.WGW_E2E_SEEN_WITHIN_MS ?? 15_000);

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 180_000 });

type Setup = { a: Tab; b: Tab; uid: string; title: string; events: string[] };
type Browser = Parameters<Parameters<typeof test>[2]>[0]["browser"];

async function seedSharedNote(id: string): Promise<{ uid: string; title: string }> {
  const uid = crypto.randomUUID();
  const title = `Undo ${id} ${uid.slice(0, 6)}`;
  const res = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: TEAM_NOTEBOOK,
    title,
    body: `body ${id}`,
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return { uid, title };
}

async function showView(tab: Tab, name: string): Promise<void> {
  await tab.getByRole("button", { name, exact: true }).first().click();
  await sleep(500);
}

async function openRow(tab: Tab, title: string): Promise<void> {
  await tab.locator(".list-item__button", { hasText: title }).first().click({ timeout: 20_000 });
  await tab.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
  await sleep(1_000);
}

async function listed(tab: Tab, title: string): Promise<boolean> {
  return (await listTitles(tab)).some((row) => row.startsWith(title));
}

/** Polls `check` in the background and remembers whether it ever held, and when. */
function watch(check: () => Promise<boolean>): { stop: () => number | null } {
  const started = Date.now();
  let seenAt: number | null = null;
  let running = true;
  void (async () => {
    while (running && seenAt === null) {
      if (await check().catch(() => false)) seenAt = Date.now() - started;
      await sleep(150);
    }
  })();
  return {
    stop: () => {
      running = false;
      return seenAt;
    },
  };
}

async function setUp(
  browser: Browser,
  id: string,
  other: "teammate" | "owner",
): Promise<{ setup: Setup; contexts: BrowserContext[] }> {
  await ensureTeamNotebook();
  const { uid, title } = await seedSharedNote(id);
  const events: string[] = [];
  const ownerContext = await openUser(browser, OWNER);
  const otherUser = other === "owner" ? OWNER : TEAMMATE;
  const otherContext = await openUser(browser, otherUser);
  const a = await openNotesTab(ownerContext, OWNER, "A", events);
  const b = await openNotesTab(otherContext, otherUser, "B", events);
  for (const tab of [a, b]) {
    await showView(tab, "All Items");
    await expect.poll(() => listed(tab, title), { timeout: 30_000 }).toBe(true);
  }
  return { setup: { a, b, uid, title, events }, contexts: [ownerContext, otherContext] };
}

type Case = {
  setup: Setup;
  /** What A does in the UI. */
  act: () => Promise<void>;
  /** The server holds the change (as the owner sees it). */
  landed: (note: ServerNote | null) => boolean;
  /** B shows the change. */
  bShowsChange: () => Promise<boolean>;
};

/** Toast texts on screen, without toasts that are playing their exit. */
async function toastsOnScreen(tab: Tab): Promise<string[]> {
  return tab
    .locator("[data-sonner-toast]:not([data-removed='true'])")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    );
}

/** Runs one case and returns its timings. */
async function actThenUndo(name: string, c: Case): Promise<void> {
  const { a, uid, events } = c.setup;
  const bSawChange = watch(c.bShowsChange);
  const actedAt = Date.now();
  await c.act();
  await expect
    .poll(async () => c.landed(await serverNote(OWNER, uid)), {
      message: `${name}: the server has the change`,
      timeout: LANDED_WITHIN_MS,
      intervals: [100],
    })
    .toBe(true);
  const landedMs = Date.now() - actedAt;

  await sleep(Math.max(0, UNDO_AFTER_MS - (Date.now() - actedAt)));
  await a.getByRole("button", { name: "Undo" }).last().click({ timeout: 2_000 });
  const undoneAt = Date.now();
  // The "… undone." toast replaces the one with Undo; the old one only plays its exit.
  await expect
    .poll(() => toastsOnScreen(a), { message: `${name}: Undo swaps the toast`, timeout: 1_000 })
    .toEqual([expect.stringMatching(/undone\./)]);
  await expect
    .poll(async () => !c.landed(await serverNote(OWNER, uid)), {
      message: `${name}: the server has the revert`,
      timeout: LANDED_WITHIN_MS + 2_000,
      intervals: [100],
    })
    .toBe(true);
  const revertLandedMs = Date.now() - undoneAt;

  await expect
    .poll(async () => !(await c.bShowsChange()), {
      message: `${name}: B ends on the reverted state`,
      timeout: B_SETTLES_WITHIN_MS,
      intervals: [200],
    })
    .toBe(true);
  // Let a late sync show its hand: B must stay reverted.
  await sleep(3_000);
  expect(await c.bShowsChange(), `${name}: B stays reverted`).toBe(false);
  const bSettledMs = Date.now() - undoneAt - 3_000;
  const sawChangeMs = bSawChange.stop();

  const line =
    `${name}: server has it after ${landedMs} ms; revert on server ${revertLandedMs} ms after Undo; ` +
    `B saw the change ${sawChangeMs === null ? "not before the revert" : `after ${sawChangeMs} ms`}; ` +
    `B reverted ${bSettledMs} ms after Undo`;
  test.info().annotations.push({ type: "latency", description: line });
  console.log(`[undo-two-users] ${line}`);
  expect(events).toEqual([]);
}

async function cleanUp(contexts: BrowserContext[], uid: string): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()));
  await api(OWNER, "DELETE", `/notes/items/${uid}`);
}

test.describe("Notes Undo seen by the other person", () => {
  test("tag", async ({ browser }) => {
    const { setup, contexts } = await setUp(browser, "tag", "teammate");
    const { a, b, uid, title } = setup;
    // Tags take letters and dashes only.
    const tag = `undo-${uid.replace(/[^a-f]/g, "").slice(0, 6)}`;
    try {
      await openRow(a, title);
      await openRow(b, title);
      await actThenUndo("tag", {
        setup,
        act: async () => {
          await a.getByRole("button", { name: "Add tag" }).click();
          await a.keyboard.type(tag, { delay: 20 });
          await a.keyboard.press("Enter");
        },
        landed: (note) => Boolean(note?.tags.includes(tag)),
        bShowsChange: async () => (await b.getByText(tag, { exact: true }).count()) > 0,
      });
    } finally {
      await cleanUp(contexts, uid);
    }
  });

  test("archive", async ({ browser }) => {
    const { setup, contexts } = await setUp(browser, "archive", "teammate");
    const { a, b, uid, title } = setup;
    try {
      await openRow(a, title);
      await actThenUndo("archive", {
        setup,
        act: () => a.getByRole("button", { name: "Archive", exact: true }).click(),
        landed: (note) => note?.archived === true,
        bShowsChange: async () => !(await listed(b, title)),
      });
    } finally {
      await cleanUp(contexts, uid);
    }
  });

  test("move", async ({ browser }) => {
    const { setup, contexts } = await setUp(browser, "move", "teammate");
    const { a, b, uid, title } = setup;
    try {
      await openRow(a, title);
      await actThenUndo("move", {
        setup,
        act: () => moveTo(a, TEAM_NOTEBOOK_NAME, PRIVATE_NOTEBOOK_NAME),
        landed: (note) => note?.notebook === "general",
        // The teammate cannot see the owner's private notebook: the note leaves their list.
        bShowsChange: async () => !(await listed(b, title)),
      });
    } finally {
      await cleanUp(contexts, uid);
    }
  });

  test("star", async ({ browser }) => {
    const { setup, contexts } = await setUp(browser, "star", "owner");
    const { a, b, uid, title } = setup;
    try {
      await showView(b, "Starred");
      await openRow(a, title);
      await actThenUndo("star", {
        setup,
        act: () => a.getByRole("button", { name: "Star", exact: true }).first().click(),
        landed: (note) => note?.starred === true,
        bShowsChange: () => listed(b, title),
      });
    } finally {
      await cleanUp(contexts, uid);
    }
  });

  // Without Undo: how soon B sees a change at all. This is the push round (#1659); the
  // spec above shows the change itself reaches the server at once.
  test("archive without Undo reaches B", async ({ browser }) => {
    const { setup, contexts } = await setUp(browser, "reach", "teammate");
    const { a, b, uid, title, events } = setup;
    try {
      await openRow(a, title);
      const actedAt = Date.now();
      await a.getByRole("button", { name: "Archive", exact: true }).click();
      await expect
        .poll(async () => !(await listed(b, title)), {
          message: "B sees the note leave its list",
          timeout: B_SETTLES_WITHIN_MS,
          intervals: [200],
        })
        .toBe(true);
      const line = `archive without Undo: B sees it after ${Date.now() - actedAt} ms`;
      test.info().annotations.push({ type: "latency", description: line });
      console.log(`[undo-two-users] ${line}`);
      expect(events).toEqual([]);
    } finally {
      await cleanUp(contexts, uid);
    }
  });
});
