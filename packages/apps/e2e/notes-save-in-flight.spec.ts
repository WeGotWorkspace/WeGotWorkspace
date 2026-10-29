// Notes metadata edited while an earlier save of the same note is on its way
// (live app and API, #1711).
//
// The test holds the save on the network, makes the next edit, then lets the
// save through. The newer edit must reach the server and every tab, and
// survive a reload.
//
// A title typed into an open note travels with the collab body save
// (`PUT /notes/items/{id}`), not the metadata outbox. So these cases edit what
// the outbox carries: tags, and the notebook a note lives in.
import { expect, test, type Request, type Route } from "@playwright/test";
import {
  api,
  converge,
  ensureTeamNotebook,
  listTitles,
  notebookKey,
  openNotesTab,
  openUser,
  OWNER,
  PRIVATE_NOTEBOOK,
  PRIVATE_NOTEBOOK_NAME,
  serverNote,
  setTabOffline,
  sleep,
  TEAM_NOTEBOOK_NAME,
  warmUpApp,
  type Tab,
} from "./helpers/notes-matrix";

test.use({ storageState: { cookies: [], origins: [] } });

/** Longer than the 1.2 s autosave debounce, so the edit is queued. */
const QUEUED_MS = 2_500;

/** A notebook move waits behind its Undo toast before it is saved. */
const MOVE_UNDO_MS = 2_500;

/** Counts answered metadata PATCHes of one note. */
function answeredPatches(tab: Tab, uid: string) {
  const answered = { count: 0 };
  tab.on("response", (response) => {
    if (isMetadataPatch(response.request()) && response.url().includes(`/notes/items/${uid}`))
      answered.count += 1;
  });
  return answered;
}

/** A request the test lets through only when it says so. */
function gate() {
  let seen!: () => void;
  let release!: () => void;
  const seenPromise = new Promise<void>((resolve) => (seen = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  let used = false;
  return {
    /** Hold the first matching request; let every later one through. */
    async hold(route: Route) {
      if (used) return route.continue();
      used = true;
      seen();
      await released;
      return route.continue();
    },
    seen: (what: string, timeoutMs = 30_000) =>
      Promise.race([
        seenPromise,
        sleep(timeoutMs).then(() => {
          throw new Error(`${what} was never sent`);
        }),
      ]),
    release,
  };
}

/** A metadata PATCH (tunnelled as POST with an override header). */
function isMetadataPatch(request: Request): boolean {
  const override = request.headers()["x-http-method-override"]?.toUpperCase();
  return request.method() === "PATCH" || (request.method() === "POST" && override === "PATCH");
}

/** All Items, once the notebooks are listed: a note made before that has no notebook. */
async function showAllItems(tab: Tab) {
  await tab
    .getByRole("button", { name: PRIVATE_NOTEBOOK_NAME, exact: true })
    .waitFor({ timeout: 60_000 });
  await tab
    .getByRole("button", { name: "All Items" })
    .click()
    .catch(() => undefined);
  await sleep(500);
}

/** A button while the note has no tags, a combobox once it has one. */
async function addTag(tab: Tab, tag: string) {
  const field = tab
    .getByRole("button", { name: "Add tag" })
    .or(tab.getByRole("combobox", { name: "Add tag" }));
  await field.first().click();
  await tab.keyboard.type(tag, { delay: 20 });
  await tab.keyboard.press("Enter");
  await tab.getByRole("button", { name: `Remove tag ${tag}` }).waitFor({ timeout: 5_000 });
  await tab.keyboard.press("Escape");
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

async function reloadNotes(tab: Tab) {
  await tab.reload();
  await tab.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
  await sleep(2_000);
  await showAllItems(tab);
}

/** Tags allow only a-z and "-". */
function letters(n: number): string {
  return n
    .toString(26)
    .split("")
    .map((c) => String.fromCharCode(97 + parseInt(c, 26)))
    .join("");
}

function annotate(events: string[]) {
  for (const event of events)
    test.info().annotations.push({ type: "page error", description: event });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await ensureTeamNotebook();
  await warmUpApp(browser);
});

test("create in flight: title and tags added meanwhile reach the server", async ({ browser }) => {
  test.setTimeout(240_000);
  const events: string[] = [];
  const run = letters(Date.now());
  const title = `in-flight create ${run}`;
  const firstTag = `first-${run}`;
  const laterTag = `later-${run}`;
  const context = await openUser(browser, OWNER);
  let uid = "";
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await showAllItems(a);

    const create = gate();
    await a.route("**/api/v1/notes/items", (route) =>
      route.request().method() === "POST" ? create.hold(route) : route.continue(),
    );
    await a.getByRole("button", { name: "New note" }).click();
    await create.seen("the create POST");
    uid = new URL(a.url()).pathname.split("/").pop() ?? "";
    expect(uid).not.toBe("");

    // Edited while the create is held.
    const titleField = a.locator(".note-detail-view__title");
    await titleField.click();
    await titleField.pressSequentially(title, { delay: 20 });
    await addTag(a, firstTag);
    await sleep(QUEUED_MS);

    // The follow-up save of those edits: held too, while one more tag is added.
    const followUp = gate();
    await a.route(`**/api/v1/notes/items/${uid}`, (route) =>
      isMetadataPatch(route.request()) ? followUp.hold(route) : route.continue(),
    );
    create.release();
    await followUp.seen("the update with the edits made during the create");
    await addTag(a, laterTag);
    await sleep(QUEUED_MS);
    followUp.release();

    await expect
      .poll(async () => serverNote(OWNER, uid), {
        message: "the server has the title and both tags",
        timeout: 60_000,
        intervals: [1_000],
      })
      .toMatchObject({ title, tags: [firstTag, laterTag].sort() });
    expect(await converge([a], uid, 60_000), "tab A mirrors the server").toEqual({});

    await reloadNotes(a);
    expect(await converge([a], uid, 30_000), "still in sync after a reload").toEqual({});
    expect(await listTitles(a)).toEqual(expect.arrayContaining([expect.stringContaining(title)]));

    const b = await openNotesTab(context, OWNER, "B", events);
    await showAllItems(b);
    expect(await converge([b], uid, 60_000), "a second tab mirrors the server").toEqual({});
    expect(await listTitles(b)).toEqual(expect.arrayContaining([expect.stringContaining(title)]));
  } finally {
    annotate(events);
    await context.close().catch(() => undefined);
    if (uid) await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});

test("update in flight: a move back while the first move is saved wins", async ({ browser }) => {
  test.setTimeout(240_000);
  const events: string[] = [];
  const uid = crypto.randomUUID();
  const title = `in-flight move ${Date.now().toString(36)}`;
  const created = await api(OWNER, "POST", "/notes/items", {
    uid,
    notebookId: PRIVATE_NOTEBOOK,
    title,
    body: "",
  });
  expect(created.status).toBe(201);
  const context = await openUser(browser, OWNER);
  try {
    const a = await openNotesTab(context, OWNER, "A", events);
    await showAllItems(a);
    await a.locator(".list-item__button", { hasText: title }).first().click({ timeout: 30_000 });
    await a.locator(".note-detail-view__title").waitFor({ timeout: 15_000 });
    await sleep(1_500);

    const answered = answeredPatches(a, uid);
    const save = gate();
    await a.route(`**/api/v1/notes/items/${uid}`, (route) =>
      isMetadataPatch(route.request()) ? save.hold(route) : route.continue(),
    );
    // Saved while offline, so it waits in the outbox; held once it is sent.
    await setTabOffline(a, true);
    await moveTo(a, TEAM_NOTEBOOK_NAME);
    await sleep(MOVE_UNDO_MS + 1_000);
    await setTabOffline(a, false);
    await save.seen("the queued move to the team notebook");

    // Moved back while that save is held: this is where it must end up.
    await moveTo(a, PRIVATE_NOTEBOOK_NAME);
    await sleep(MOVE_UNDO_MS + 1_000);
    save.release();

    const general = notebookKey(PRIVATE_NOTEBOOK);
    await expect
      .poll(async () => answered.count, { message: "both moves answered", timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => (await serverNote(OWNER, uid))?.notebook, {
        message: "the server holds the last move",
        timeout: 30_000,
        intervals: [1_000],
      })
      .toBe(general);
    expect(await converge([a], uid, 60_000), "tab A mirrors the server").toEqual({});

    await reloadNotes(a);
    expect(await converge([a], uid, 30_000), "still in sync after a reload").toEqual({});
    expect((await serverNote(OWNER, uid))?.notebook).toBe(general);
  } finally {
    annotate(events);
    await context.close().catch(() => undefined);
    await api(OWNER, "DELETE", `/notes/items/${uid}`).catch(() => undefined);
  }
});
