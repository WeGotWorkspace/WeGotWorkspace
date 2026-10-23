// Notes sync matrix (live app). Every action × tab setup × connectivity case
// gets its own note. After the action and the reconnect, the server holds the
// change, every tab mirrors the server in its cache and its list, and that
// still holds after a hard refresh of every tab.
//
// Tabs:  one (owner) · same (two owner tabs) · diff (owner and teammate).
// Net:   on · off (one tab) · both · aOff (actor offline) · bOff (other tab offline).
// The actor is always tab A (the owner). Run one case with --grep "title · same · aOff".
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import {
  api,
  converge,
  ensureTeamNotebook,
  listTitles,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  PRIVATE_NOTEBOOK_NAME,
  serverNote,
  setTabOffline,
  sleep,
  TEAM_NOTEBOOK,
  TEAM_NOTEBOOK_NAME,
  TEAMMATE,
  type ServerNote,
  type Tab,
} from "./helpers/notes-matrix";

type Tabs = "one" | "same" | "diff";
type Net = "on" | "off" | "both" | "aOff" | "bOff";
type Case = { action: Action; tabs: Tabs; net: Net; id: string; title: string; uid: string };

const NETS: Record<Tabs, Net[]> = {
  one: ["on", "off"],
  same: ["on", "both", "aOff", "bOff"],
  diff: ["on", "both", "aOff", "bOff"],
};

// --- the actor's steps -------------------------------------------------------------------------

async function showAllItems(tab: Tab) {
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await sleep(500);
}

async function openRow(tab: Tab, title: string) {
  await tab.locator(".list-item__button", { hasText: title }).first().click({ timeout: 15_000 });
  await tab.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
  await sleep(1_500);
}

async function editor(tab: Tab) {
  const body = tab.locator(".ProseMirror").first();
  await body.waitFor({ timeout: 15_000 });
  return body;
}

async function moveTo(tab: Tab, notebook: string) {
  await tab.locator(".color-swatch-trigger").first().click();
  await sleep(400);
  await tab
    .locator("[role='menuitem'], [role='option'], [role='menuitemradio']", { hasText: notebook })
    .first()
    .click();
  await sleep(500);
  const dialog = tab.getByRole("alertdialog").or(tab.getByRole("dialog"));
  if (await dialog.count())
    await dialog.first().getByRole("button", { name: /move/i }).first().click();
  await sleep(800);
}

const ACTIONS = {
  async create(tab: Tab, c: Case) {
    if (c.tabs === "diff") {
      await tab.getByRole("button", { name: TEAM_NOTEBOOK_NAME, exact: true }).click();
      await sleep(800);
    }
    await tab.getByRole("button", { name: "New note" }).click();
    const title = tab.locator(".note-detail-view__title");
    await title.waitFor({ timeout: 15_000 });
    await sleep(800);
    await title.click();
    await title.pressSequentially(c.title, { delay: 25 });
    const body = await editor(tab);
    await body.click();
    await body.pressSequentially(`body ${c.id}`, { delay: 20 });
    await sleep(2_500);
    c.uid = new URL(tab.url()).pathname.split("/").pop() ?? "";
  },
  async title(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    const title = tab.locator(".note-detail-view__title");
    await title.click();
    await tab.keyboard.press("ControlOrMeta+A");
    await title.pressSequentially(`${c.title} v2`, { delay: 25 });
    await sleep(2_500);
  },
  async body(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    const body = await editor(tab);
    await body.click();
    await body.press("End");
    await body.pressSequentially(" +edit", { delay: 25 });
    await sleep(2_500);
  },
  async emptyBody(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    const body = await editor(tab);
    await body.click();
    await tab.keyboard.press("ControlOrMeta+A");
    await tab.keyboard.press("Backspace");
    await sleep(2_500);
  },
  async tagAdd(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await tab.getByRole("button", { name: "Add tag" }).click();
    await tab.keyboard.type(`add-${c.id}`, { delay: 25 });
    await tab.keyboard.press("Enter");
    await sleep(3_500);
  },
  async tagRemove(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await tab.getByRole("button", { name: `Remove tag t-${c.id}` }).click();
    await sleep(3_500);
  },
  async tagRename(tab: Tab, c: Case) {
    await tab.getByRole("button", { name: `Rename tag t-${c.id}` }).click();
    const dialog = tab.getByRole("dialog");
    await dialog.locator("input").fill(`rn-${c.id}`);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await sleep(3_500);
  },
  async archive(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await tab.getByRole("button", { name: "Archive", exact: true }).click();
    await sleep(3_500);
  },
  async delete(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await tab.getByRole("button", { name: "Archive", exact: true }).click();
    await sleep(3_500);
    await tab.getByRole("button", { name: "Archived" }).click();
    await sleep(1_000);
    await tab.getByRole("button", { name: "Empty archive" }).click();
    const dialog = tab.getByRole("alertdialog").or(tab.getByRole("dialog"));
    await dialog
      .first()
      .getByRole("button", { name: /delete|empty/i })
      .last()
      .click();
    await sleep(3_500);
  },
  async toShared(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await moveTo(tab, TEAM_NOTEBOOK_NAME);
  },
  async toPrivate(tab: Tab, c: Case) {
    await openRow(tab, c.title);
    await moveTo(tab, PRIVATE_NOTEBOOK_NAME);
  },
} satisfies Record<string, (tab: Tab, c: Case) => Promise<void>>;
type Action = keyof typeof ACTIONS;

/** What the owner sees on the server once the action landed. */
const LANDED: Record<Action, (note: ServerNote | null, c: Case) => boolean> = {
  create: (n, c) => n !== null && n.title === c.title && n.body.startsWith(`body ${c.id}`),
  title: (n, c) => n?.title === `${c.title} v2`,
  body: (n) => Boolean(n?.body.includes("+edit")),
  emptyBody: (n) => n !== null && n.body === "",
  tagAdd: (n, c) => Boolean(n?.tags.includes(`add-${c.id}`)),
  tagRemove: (n, c) => n !== null && !n.tags.includes(`t-${c.id}`),
  tagRename: (n, c) => Boolean(n?.tags.includes(`rn-${c.id}`) && !n.tags.includes(`t-${c.id}`)),
  archive: (n) => n?.archived === true,
  delete: (n) => n === null,
  toShared: (n) => n?.notebook === "e2e-notes-team",
  toPrivate: (n) => n?.notebook === "general",
};

// --- one case ----------------------------------------------------------------------------------

/** Tags hold letters and hyphens only. */
function caseId(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

async function seedNote(c: Case): Promise<void> {
  // The teammate sees only the shared notebook, so their cases start there.
  const shared = c.tabs === "diff" ? c.action !== "toShared" : c.action === "toPrivate";
  c.uid = crypto.randomUUID();
  const res = await api(OWNER, "POST", "/notes/items", {
    uid: c.uid,
    notebookId: shared ? TEAM_NOTEBOOK : PRIVATE_NOTEBOOK,
    title: c.title,
    body: `body ${c.id}`,
    categories: [`t-${c.id}`],
  });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
}

async function runCase(browser: Browser, c: Case): Promise<void> {
  const events: string[] = [];
  const contexts: BrowserContext[] = [];
  try {
    if (c.action !== "create") await seedNote(c);
    const ownerContext = await openUser(browser, OWNER);
    contexts.push(ownerContext);
    const a = await openNotesTab(ownerContext, OWNER, "A", events);
    let b: Tab | null = null;
    if (c.tabs === "same") b = await openNotesTab(ownerContext, OWNER, "A2", events);
    if (c.tabs === "diff") {
      const teammateContext = await openUser(browser, TEAMMATE);
      contexts.push(teammateContext);
      b = await openNotesTab(teammateContext, TEAMMATE, "B", events);
    }
    const tabs = b ? [a, b] : [a];
    if (c.uid) {
      expect(await converge(tabs, c.uid, 20_000), "every tab loads the note first").toEqual({});
    }
    for (const tab of tabs) await showAllItems(tab);

    const offline = { on: [], off: [a], both: tabs, aOff: [a], bOff: b ? [b] : [] }[c.net];
    for (const tab of offline) await setTabOffline(tab, true);
    await sleep(1_000);
    await a.bringToFront();
    await ACTIONS[c.action](a, c);
    await sleep(1_000);
    for (const tab of offline) await setTabOffline(tab, false);

    // Live: the server holds the action and every tab mirrors the server.
    await expect
      .poll(async () => LANDED[c.action](await serverNote(OWNER, c.uid), c), {
        message: "the server holds the action",
        timeout: 30_000,
        intervals: [1_500],
      })
      .toBe(true);
    expect(await converge(tabs, c.uid, 30_000), "every tab mirrors the server").toEqual({});

    // A hard refresh of every tab changes nothing.
    for (const tab of tabs) {
      await tab.reload();
      await tab.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
    }
    await sleep(3_000);
    expect(await converge(tabs, c.uid, 15_000), "still in sync after a hard refresh").toEqual({});
    for (const tab of tabs) {
      await showAllItems(tab);
      const want = await serverNote(tab.user, c.uid);
      const shown = (await listTitles(tab)).some((t) => want !== null && t.startsWith(want.title));
      expect(shown, `${tab.tag} lists the note exactly when it is active`).toBe(
        want !== null && !want.archived,
      );
    }
  } finally {
    // Offline, a "Failed to fetch" is expected: report page errors, do not fail on them.
    for (const event of events)
      test.info().annotations.push({ type: "page error", description: event });
    for (const context of contexts) await context.close().catch(() => undefined);
  }
}

// --- the matrix --------------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
  await ensureTeamNotebook();
});

for (const action of Object.keys(ACTIONS) as Action[]) {
  for (const tabs of Object.keys(NETS) as Tabs[]) {
    for (const net of NETS[tabs]) {
      test(`${action} · ${tabs} · ${net}`, async ({ browser }) => {
        const id = caseId();
        await runCase(browser, {
          action,
          tabs,
          net,
          id,
          title: `M ${action} ${tabs} ${net} ${id}`,
          uid: "",
        });
      });
    }
  }
}
