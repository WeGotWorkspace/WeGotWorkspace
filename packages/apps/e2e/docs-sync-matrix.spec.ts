// Docs sync matrix (live app, #1563). Every action × tab setup × connectivity
// case gets its own Doc, named after the case id. Tab A does the action in the
// UI. After the reconnect, the server holds the change, and every tab mirrors
// the server as its own user sees it: no queued write is left, no cached home
// view still lists the Doc where it no longer is, the cached stars match, the
// open list or editor shows it. That still holds after a hard refresh of every
// tab, in each of the home views (All Docs, Starred, Trash, Shared with me).
//
// Tabs:  one (owner) · same (two owner tabs, one cache) · diff (owner and
//        teammate, two caches; the Doc is in the Team folder both can edit,
//        except where the action gives the teammate the Doc: move, share).
// Net:   on · off (one tab) · both · aOff (actor offline) · bOff (other tab offline).
//
// Not every action runs every setup (`Nets` below): an edit of one field runs
// where it can get lost, Restore and Delete act on the owner's own Trash, and
// sharing needs a second person. The fixed offline gaps each have a case:
//   gap 1  createTaken  an offline create whose name was taken meanwhile keeps both
//   gap 2  renameOpen   a rename while another tab or person has the Doc open offline
//   gap 3  star, unstar, trash, restore offline; delete and share say they need a connection
//   gap 4  every offline case: "Changes synced" never shows while the tab is offline
//   gap 5  every offline case: no "Failed to fetch" on screen
//
// No fixed waits: every step waits for what it needs (a row, the offline
// badge, the Drive cache knowing the file, the server holding the write).
// Run one case with --grep "rename · same · aOff".
import type { Browser, BrowserContext, Locator } from "@playwright/test";
import {
  dav,
  driveKnows,
  home,
  listFolder,
  makeFolder,
  normalizePath,
  openUser,
  OWNER,
  putDoc,
  readDoc,
  removeQuietly,
  serverStars,
  setTabOffline,
  sharedWith,
  starOnServer,
  tabCache,
  TEAM_ROOT,
  TEAMMATE,
  trashOf,
  unshareQuietly,
  type Tab,
} from "./helpers/docs-matrix";
import { expect, test } from "./helpers/live-test";

type Tabs = "one" | "same" | "diff";
type Net = "on" | "off" | "both" | "aOff" | "bOff";
type Nets = Partial<Record<Tabs, Net[]>>;
type View = "All Docs" | "Starred" | "Trash" | "Shared with me";

const FULL: Nets = {
  one: ["on", "off"],
  same: ["on", "both", "aOff", "bOff"],
  diff: ["on", "both", "aOff", "bOff"],
};
/** One field: queued offline, and arriving at the other tab or person late. */
const FIELD: Nets = { one: ["off"], same: ["aOff"], diff: ["aOff"] };
/** The owner's own Trash: no second person. */
const OWN: Nets = { one: ["on", "off"], same: ["on", "aOff", "bOff"] };

/** Letters only, so a case id never matches another case's Doc. */
function caseId(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

type Case = {
  action: Action;
  tabs: Tabs;
  net: Net;
  id: string;
  /** File name without `.md`. */
  name: string;
  /** Folder the Doc starts in. */
  dir: string;
  /** Where a move takes it. */
  dest: string;
};

const docPath = (dir: string, base: string) => `${dir}/${base}.md`;
const startPath = (c: Case) => docPath(c.dir, c.name);
/** A token typed into the editor: letters only ("6x9" would become "6×9"). */
const token = (c: Case, who: string) => `tok${who}${c.id}`;

// --- what the server holds, as one user sees it ------------------------------------------------

type Server = {
  /** The case's Docs outside Trash, by path. */
  active: string[];
  /** The case's Docs in this user's Trash. */
  trash: string[];
  /** Active Docs this user starred. */
  starred: string[];
  /** Docs shared with this user (by the owner's path). */
  shared: string[];
};

async function serverState(user: string, c: Case): Promise<Server> {
  const folders = new Set(
    user === OWNER ? [home(OWNER), TEAM_ROOT, c.dest, c.dir] : [TEAM_ROOT, c.dest, c.dir],
  );
  const mine = (names: string[], dir: string) =>
    names.filter((name) => name.includes(c.id)).map((name) => `${dir}/${name}`);
  const active: string[] = [];
  for (const dir of folders) {
    // The teammate cannot list the owner's home: a share shows in `shared` instead.
    if (user !== OWNER && dir.startsWith(home(OWNER))) continue;
    active.push(...mine(await listFolder(user, dir), dir).filter((p) => p.endsWith(".md")));
  }
  const trashDir = trashOf(home(user));
  const trash = mine(await listFolder(user, trashDir), trashDir);
  const stars = new Set(await serverStars(user));
  const shared = user === OWNER ? [] : (await sharedWith(user)).filter((p) => p.includes(c.id));
  const unique = [...new Set(active)].sort();
  return {
    active: unique,
    trash: trash.sort(),
    starred: [...unique, ...shared].filter((p) => stars.has(normalizePath(p))),
    shared,
  };
}

const nameOf = (apiPath: string) => apiPath.split("/").pop() ?? "";

/** The names a home view of this user should list for the case. */
function expectedRows(s: Server, view: View, user: string): string[] {
  const names = (paths: string[]) => paths.map(nameOf).sort();
  if (view === "Starred") return names(s.starred);
  if (view === "Trash") return names(s.trash);
  if (view === "Shared with me") return names(s.shared);
  return names(user === OWNER ? s.active : [...s.active, ...s.shared]);
}

// --- the UI ------------------------------------------------------------------------------------

function sidebarView(tab: Tab, name: string): Locator {
  return tab.locator(".docs-workspace").getByRole("button", { name, exact: true }).first();
}

function row(tab: Tab, fileName: string): Locator {
  return tab.locator(".drive-list-row", { hasText: fileName });
}

async function waitForHome(tab: Tab): Promise<void> {
  await expect(tab.locator(".docs-home-pane")).toBeVisible({ timeout: 60_000 });
}

/** A Docs tab that records page errors and toasts (with whether it was online) for the case. */
async function openDocsTab(
  context: BrowserContext,
  user: string,
  tag: string,
  events: string[],
): Promise<Tab> {
  const tab = (await context.newPage()) as Tab;
  tab.tag = tag;
  tab.user = user;
  tab.on("pageerror", (error) => events.push(`${tag} page error: ${String(error).slice(0, 160)}`));
  await tab.addInitScript(() => {
    const log: { text: string; online: boolean }[] = [];
    (window as unknown as { __toasts: typeof log }).__toasts = log;
    const seen = new WeakSet<Node>();
    new MutationObserver(() => {
      document.querySelectorAll("[data-sonner-toast]").forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        log.push({ text: element.textContent ?? "", online: navigator.onLine });
      });
    }).observe(document, { childList: true, subtree: true });
  });
  await tab.goto("/docs");
  await waitForHome(tab);
  return tab;
}

async function showView(tab: Tab, view: View): Promise<void> {
  await sidebarView(tab, view).click();
  await expect(tab.getByRole("heading", { level: 2, name: view, exact: true })).toBeVisible();
}

/** Names of the case's rows in the tab's open home list. */
async function listedRows(tab: Tab, c: Case): Promise<string[]> {
  const rows = tab.locator(".drive-list-row", { hasText: c.id });
  const names: string[] = [];
  for (const one of await rows.all()) {
    names.push(
      (
        (await one.locator(".drive-list-row__name .font-medium").first().textContent()) ?? ""
      ).trim(),
    );
  }
  return names.sort();
}

async function openRowMenu(tab: Tab, fileName: string): Promise<Locator> {
  await row(tab, fileName).getByRole("button", { name: "More actions" }).click();
  return tab.getByRole("menu");
}

/** Star, trash and delete run once their Undo toast closes; wait for that. */
async function undoWindowsClosed(tab: Tab): Promise<void> {
  await expect(tab.locator("[data-sonner-toast]", { hasText: "Undo" })).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function setOffline(tab: Tab, offline: boolean): Promise<void> {
  await setTabOffline(tab, offline);
  await expect(tab.locator(`[data-connectivity="${offline ? "offline" : "online"}"]`)).toBeVisible({
    timeout: 20_000,
  });
}

async function openEditor(tab: Tab, apiPath: string): Promise<void> {
  await tab.goto(`/docs?file=${encodeURIComponent(apiPath.replace(/^\/+/, ""))}`);
  await expect(tab.locator(".ProseMirror")).toBeVisible({ timeout: 60_000 });
  await expect(tab.locator('[data-connectivity="online"]')).toBeVisible();
}

async function typeAtEnd(tab: Tab, text: string): Promise<void> {
  const editor = tab.locator(".ProseMirror");
  // Read-only until the Doc's sharing rights load (slower in Team): keys before that are dropped.
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(` ${text}`, { delay: 20 });
  await expect(editor).toContainText(text);
}

/** The editor holds the typed text: on the server when online, queued when offline. */
async function typedTextHeld(tab: Tab, apiPath: () => Promise<string>, text: string) {
  if (await tab.locator('[data-connectivity="offline"]').isVisible()) {
    await expect(tab.getByRole("status", { name: "Unsaved changes" })).toBeVisible({
      timeout: 15_000,
    });
    return;
  }
  await expect
    .poll(async () => (await readDoc(tab.user, await apiPath())) ?? "", { timeout: 30_000 })
    .toContain(text);
}

/** The editor's text, without the name labels of other people's carets. */
async function editorText(tab: Tab): Promise<string> {
  return tab.locator(".ProseMirror").evaluate((editor) => {
    const copy = editor.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[class*='collaboration-carets__']").forEach((caret) => caret.remove());
    return copy.textContent ?? "";
  });
}

/** Which file the editor shows: its path link, or the tab title once opened by id (#1751). */
async function editorShows(tab: Tab): Promise<string> {
  return new URL(tab.url()).searchParams.get("file") ?? (await tab.title());
}

// --- the actions -------------------------------------------------------------------------------

type ActionDef = {
  nets: Nets;
  /** Seed what the case starts from (default: one Doc at the start path). */
  seed?: (c: Case) => Promise<void>;
  /** Tab A's view, or the editor, before the action. */
  aView?: View | "editor";
  /** The other tab's view, or the editor. */
  bView?: View | "editor";
  /** The UI steps of the action in tab A (and, for some, tab B). */
  run: (a: Tab, b: Tab | null, c: Case) => Promise<void>;
  /** The server holds the action (`mate` is the teammate's view, in a diff case). */
  landed: (owner: Server, mate: Server | null, c: Case) => Promise<boolean> | boolean;
  /** Text every open editor shows once the tabs caught up. */
  editorText?: (c: Case) => string[];
};

async function seedDoc(c: Case, path = startPath(c)): Promise<void> {
  await putDoc(OWNER, path, `# ${c.name}\n\nbody ${c.id}\n`);
}

async function renameFromRow(tab: Tab, fileName: string, nextBase: string): Promise<void> {
  const menu = await openRowMenu(tab, fileName);
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = tab.getByRole("dialog", { name: "Rename document" });
  await dialog.getByRole("textbox").fill(nextBase);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
}

/** In the Move dialog (it opens inside Personal), select a drive root. */
async function pickDrive(dialog: Locator, drive: "Personal" | "Team"): Promise<void> {
  const target = dialog.getByRole("row", { name: drive, exact: true });
  const up = dialog
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("button", { name: "Drives" });
  await expect(target.or(up).first()).toBeVisible({ timeout: 15_000 });
  if (!(await target.isVisible())) await up.click();
  await target.click();
}

async function createDoc(tab: Tab, c: Case, body: string): Promise<void> {
  // The dialog creates in the drive open in the sidebar (Personal from All Docs).
  if (c.dir === TEAM_ROOT) {
    await sidebarView(tab, "Team").click();
    await expect(tab.getByRole("heading", { level: 2, name: "Team", exact: true })).toBeVisible();
  }
  const dialog = tab.getByRole("dialog", { name: "New document" });
  // The button does nothing until the home knows the signed-in user: click until it opens.
  await expect(async () => {
    await tab.getByRole("button", { name: "New document" }).first().click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByRole("textbox", { name: "Name" }).fill(c.name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(tab.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
  await typeAtEnd(tab, body);
}

async function trashFromRow(tab: Tab, fileName: string): Promise<void> {
  const menu = await openRowMenu(tab, fileName);
  await menu.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await tab.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(row(tab, fileName)).toHaveCount(0, { timeout: 15_000 });
  await undoWindowsClosed(tab);
}

async function toggleStar(tab: Tab, fileName: string, item: "Star" | "Unstar"): Promise<void> {
  const menu = await openRowMenu(tab, fileName);
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
  await undoWindowsClosed(tab);
}

const isOnly = (paths: string[], want: string) => paths.length === 1 && paths[0] === want;

const ACTIONS = {
  create: {
    nets: { one: ["on", "off"], same: FULL.same, diff: ["on", "aOff"] },
    seed: async () => undefined,
    run: async (a, _b, c) => {
      await createDoc(a, c, token(c, "a"));
    },
    landed: async (s, _m, c) =>
      isOnly(s.active, startPath(c)) &&
      ((await readDoc(OWNER, startPath(c))) ?? "").includes(token(c, "a")),
    editorText: (c) => [token(c, "a")],
  },
  /** Gap 1: offline, a create whose name another device took meanwhile keeps both. */
  createTaken: {
    nets: { one: ["off"], same: ["aOff"] },
    seed: async () => undefined,
    run: async (a, _b, c) => {
      // The name is taken on the server while A is offline, before A creates it. Not after:
      // an online tab of the same person sends A's queued create at once.
      await putDoc(OWNER, startPath(c), `# server copy\n\nserver ${c.id}\n`);
      await createDoc(a, c, token(c, "a"));
    },
    landed: async (s, _m, c) => {
      const kept = docPath(c.dir, `${c.name} (1)`);
      if (s.active.join("|") !== [startPath(c), kept].sort().join("|")) return false;
      const server = (await readDoc(OWNER, startPath(c))) ?? "";
      const local = (await readDoc(OWNER, kept)) ?? "";
      return (
        server.includes(`server ${c.id}`) &&
        !server.includes(token(c, "a")) &&
        local.includes(token(c, "a"))
      );
    },
    editorText: (c) => [token(c, "a")],
  },
  rename: {
    nets: FULL,
    run: async (a, _b, c) => {
      await renameFromRow(a, `${c.name}.md`, `${c.name} v2`);
      await expect(row(a, `${c.name} v2.md`)).toBeVisible();
    },
    landed: (s, _m, c) => isOnly(s.active, docPath(c.dir, `${c.name} v2`)),
  },
  /** Gap 2: the other tab (or person) has the Doc open and types offline while A renames it. */
  renameOpen: {
    nets: { same: ["both", "aOff", "bOff"], diff: ["bOff"] },
    bView: "editor",
    run: async (a, b, c) => {
      await typeAtEnd(b!, token(c, "b"));
      await renameFromRow(a, `${c.name}.md`, `${c.name} v2`);
      await expect(row(a, `${c.name} v2.md`)).toBeVisible();
      if (c.tabs === "same" && c.net === "aOff") {
        // B follows the queued rename, then reloads before it lands: it opens the new name.
        const renamed = `${c.name} v2`;
        await expect.poll(() => editorShows(b!), { timeout: 20_000 }).toContain(renamed);
        await b!.reload();
        await expect(b!.locator(".ProseMirror")).toContainText(token(c, "b"), { timeout: 60_000 });
        await expect.poll(() => editorShows(b!), { timeout: 20_000 }).toContain(renamed);
      }
    },
    landed: async (s, _m, c) =>
      isOnly(s.active, docPath(c.dir, `${c.name} v2`)) &&
      ((await readDoc(OWNER, docPath(c.dir, `${c.name} v2`))) ?? "").includes(token(c, "b")),
    editorText: (c) => [token(c, "b")],
  },
  move: {
    nets: { one: ["on", "off"], same: FULL.same, diff: ["on", "aOff"] },
    seed: async (c) => {
      if (c.dest !== TEAM_ROOT) await makeFolder(OWNER, c.dest);
      await seedDoc(c);
    },
    run: async (a, _b, c) => {
      const menu = await openRowMenu(a, `${c.name}.md`);
      await menu.getByRole("menuitem", { name: "Move" }).click();
      const dialog = a.getByRole("dialog", { name: "Move to folder" });
      if (c.dest === TEAM_ROOT) await pickDrive(dialog, "Team");
      else await dialog.getByRole("row", { name: nameOf(c.dest) }).click();
      await dialog.getByRole("button", { name: "Move here" }).click();
      await expect(dialog).toBeHidden();
      await undoWindowsClosed(a);
    },
    landed: (s, _m, c) => isOnly(s.active, docPath(c.dest, c.name)),
  },
  body: {
    nets: FULL,
    aView: "editor",
    bView: "editor",
    run: async (a, _b, c) => {
      await typeAtEnd(a, token(c, "a"));
      await typedTextHeld(a, async () => startPath(c), token(c, "a"));
    },
    landed: async (_s, _m, c) =>
      ((await readDoc(OWNER, startPath(c))) ?? "").includes(token(c, "a")),
    editorText: (c) => [token(c, "a")],
  },
  /** Both tabs (or people) type at once: the reconnect merges both. */
  bodyBoth: {
    nets: { same: ["both"], diff: ["on", "both"] },
    aView: "editor",
    bView: "editor",
    run: async (a, b, c) => {
      await typeAtEnd(a, token(c, "a"));
      await typeAtEnd(b!, token(c, "b"));
    },
    landed: async (_s, _m, c) => {
      const text = (await readDoc(OWNER, startPath(c))) ?? "";
      return text.includes(token(c, "a")) && text.includes(token(c, "b"));
    },
    editorText: (c) => [token(c, "a"), token(c, "b")],
  },
  emptyBody: {
    nets: FIELD,
    aView: "editor",
    bView: "editor",
    run: async (a, _b, c) => {
      const editor = a.locator(".ProseMirror");
      await editor.click();
      await a.keyboard.press("ControlOrMeta+A");
      await a.keyboard.press("Backspace");
      // The other tab of the same person shows its caret label inside the editor (#2104).
      await expect.poll(() => editorText(a)).toBe("");
      await typedTextHeld(a, async () => startPath(c), "");
    },
    landed: async (_s, _m, c) => ((await readDoc(OWNER, startPath(c))) ?? "x").trim() === "",
    editorText: () => [],
  },
  trash: {
    nets: FULL,
    run: async (a, _b, c) => {
      await trashFromRow(a, `${c.name}.md`);
    },
    landed: (s, _m, c) =>
      s.active.length === 0 && isOnly(s.trash, `${trashOf(home(OWNER))}/${c.name}.md`),
  },
  /** Restore: move the Doc out of Trash, back to Personal. */
  restore: {
    nets: OWN,
    seed: async (c) => {
      await makeFolder(OWNER, trashOf(home(OWNER)));
      await seedDoc(c, `${trashOf(home(OWNER))}/${c.name}.md`);
    },
    aView: "Trash",
    bView: "Trash",
    run: async (a, _b, c) => {
      const menu = await openRowMenu(a, `${c.name}.md`);
      await menu.getByRole("menuitem", { name: "Move" }).click();
      const dialog = a.getByRole("dialog", { name: "Move to folder" });
      await dialog.getByRole("button", { name: "Move here" }).click();
      await expect(dialog).toBeHidden();
      await expect(row(a, `${c.name}.md`)).toHaveCount(0, { timeout: 15_000 });
      await undoWindowsClosed(a);
    },
    landed: (s, _m, c) => isOnly(s.active, startPath(c)) && s.trash.length === 0,
  },
  /** Delete for good from Trash. It needs the server: offline it says so and keeps the Doc. */
  delete: {
    nets: OWN,
    seed: async (c) => {
      await makeFolder(OWNER, trashOf(home(OWNER)));
      await seedDoc(c, `${trashOf(home(OWNER))}/${c.name}.md`);
    },
    aView: "Trash",
    bView: "Trash",
    run: async (a, _b, c) => {
      const offline = await a.locator('[data-connectivity="offline"]').isVisible();
      const menu = await openRowMenu(a, `${c.name}.md`);
      await menu.getByRole("menuitem", { name: "Delete permanently" }).click();
      await a.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      if (offline) {
        await expect(a.getByText("Deleting permanently needs a connection.")).toBeVisible();
        await expect(row(a, `${c.name}.md`)).toBeVisible();
      } else {
        await undoWindowsClosed(a);
        await expect(row(a, `${c.name}.md`)).toHaveCount(0, { timeout: 15_000 });
      }
    },
    landed: (s, _m, c) =>
      ["off", "aOff"].includes(c.net)
        ? isOnly(s.trash, `${trashOf(home(OWNER))}/${c.name}.md`)
        : s.trash.length === 0 && s.active.length === 0,
  },
  star: {
    nets: { one: ["on", "off"], same: FULL.same, diff: ["on", "aOff"] },
    bView: "Starred",
    run: async (a, _b, c) => {
      await toggleStar(a, `${c.name}.md`, "Star");
    },
    // A star is per person: the teammate's stays off.
    landed: (s, m, c) => isOnly(s.starred, startPath(c)) && (m === null || m.starred.length === 0),
  },
  unstar: {
    nets: { one: ["off"], same: ["aOff", "bOff"] },
    seed: async (c) => {
      await seedDoc(c);
      await starOnServer(OWNER, startPath(c));
    },
    bView: "Starred",
    run: async (a, _b, c) => {
      await toggleStar(a, `${c.name}.md`, "Unstar");
    },
    landed: (s) => s.starred.length === 0 && s.active.length === 1,
  },
  /** Share with the teammate. It needs the server: offline the dialog says it cannot load. */
  share: {
    nets: { one: ["off"], diff: ["on", "bOff"] },
    bView: "Shared with me",
    run: async (a, _b, c) => {
      const offline = await a.locator('[data-connectivity="offline"]').isVisible();
      const menu = await openRowMenu(a, `${c.name}.md`);
      await menu.getByRole("menuitem", { name: "Share" }).click();
      const dialog = a.getByRole("dialog", { name: `Share ${c.name}.md` });
      await expect(dialog).toBeVisible();
      if (offline) {
        await expect(dialog.getByText("Could not load sharing settings.")).toBeVisible({
          timeout: 15_000,
        });
        await a.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        return;
      }
      await dialog.getByPlaceholder("Add people or teams…").pressSequentially(TEAMMATE);
      // The search results open in a popover outside the dialog.
      await a
        .getByRole("option", { name: /Member/ })
        .first()
        .click();
      await expect(dialog.getByText("Member", { exact: true }).first()).toBeVisible();
      await a.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    },
    landed: async (_s, _m, c) => {
      const shared = (await sharedWith(TEAMMATE)).some((p) => p === normalizePath(startPath(c)));
      return c.net === "off" ? !shared : shared;
    },
  },
} satisfies Record<string, ActionDef>;
type Action = keyof typeof ACTIONS;

// --- does every tab mirror the server ----------------------------------------------------------

/** What the tab's open home view shows, if a home view is open. */
async function openView(tab: Tab): Promise<View | null> {
  if (!(await tab.locator(".docs-home-pane").isVisible())) return null;
  const heading = (await tab.locator(".docs-home-pane h2").first().textContent()) ?? "";
  const views: View[] = ["All Docs", "Starred", "Trash", "Shared with me"];
  return views.find((view) => heading.trim() === view) ?? null;
}

async function tabDiff(tab: Tab, s: Server, c: Case, text: string[]): Promise<string[]> {
  const diffs: string[] = [];
  const cache = await tabCache(tab);
  if (cache.missingDb) return ["no Docs offline cache"];
  const queued = cache.outbox.filter((payload) => payload.includes(c.id));
  if (queued.length) diffs.push(`outbox: ${queued.join(" ")}`);
  // A cached home view may lack the Doc (it is cached when shown), but never lists it where it is not.
  const live = new Set([...s.active, ...s.shared].map((p) => p.replace(/^\/+/, "")));
  for (const [key, paths] of Object.entries(cache.views)) {
    if (key.includes(".Trash")) continue;
    const stale = paths.filter((p) => p.includes(c.id) && !live.has(p));
    if (stale.length) diffs.push(`cached view ${key.slice(0, 60)} lists ${stale.join(", ")}`);
  }
  const cachedStars = cache.stars.filter((p) => p.includes(c.id)).sort();
  const stars = s.starred.map(normalizePath).sort();
  if (cachedStars.join("|") !== stars.join("|")) {
    diffs.push(`cached stars [${cachedStars}] ≠ [${stars}]`);
  }
  const view = await openView(tab);
  if (view) {
    const shown = await listedRows(tab, c);
    const want = expectedRows(s, view, tab.user);
    if (shown.join("|") !== want.join("|")) diffs.push(`${view} shows [${shown}] ≠ [${want}]`);
  } else if (await tab.locator(".ProseMirror").isVisible()) {
    const shows = await editorShows(tab);
    const doc = [...s.active, ...s.shared][0];
    if (doc && !shows.includes(nameOf(doc).replace(/\.md$/, ""))) {
      diffs.push(`editor shows ${shows}, the Doc is ${doc}`);
    }
    const body = await editorText(tab);
    const missing = text.filter((t) => !body.includes(t));
    if (missing.length) diffs.push(`editor lacks ${missing.join(", ")}`);
    if (text.length === 0 && body.trim() !== "")
      diffs.push(`editor not empty: "${body.slice(0, 40)}"`);
    if (await tab.getByRole("status", { name: "Unsaved changes" }).isVisible()) {
      diffs.push("editor still has unsaved changes");
    }
  }
  return diffs;
}

/** Poll until every tab mirrors the server for the case; returns what still differs. */
async function converge(
  tabs: Tab[],
  c: Case,
  timeoutMs: number,
): Promise<Record<string, string[]>> {
  const def: ActionDef = ACTIONS[c.action];
  const text = def.editorText?.(c) ?? [];
  const until = Date.now() + timeoutMs;
  let open: Record<string, string[]> = {};
  do {
    open = {};
    const servers = new Map<string, Server>();
    for (const tab of tabs) {
      if (!servers.has(tab.user)) servers.set(tab.user, await serverState(tab.user, c));
      // Look at the tab, as a person would: a hidden tab may wait to refresh until shown.
      await tab.bringToFront();
      const diffs = await tabDiff(tab, servers.get(tab.user)!, c, text).catch((error: unknown) => [
        `check failed: ${String(error).slice(0, 120)}`,
      ]);
      if (diffs.length) open[tab.tag] = diffs;
    }
    if (Object.keys(open).length === 0) return {};
    // Wait for the next change in any tab's list or editor, or two seconds at most.
    await Promise.race(
      tabs.map((tab) =>
        tab
          .waitForFunction(
            () =>
              new Promise((resolve) => {
                const observer = new MutationObserver(() => {
                  observer.disconnect();
                  resolve(true);
                });
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                  characterData: true,
                });
              }),
            undefined,
            { timeout: 2_000 },
          )
          .catch(() => undefined),
      ),
    );
  } while (Date.now() < until);
  return open;
}

// --- one case ----------------------------------------------------------------------------------

type Session = { tabs: Tab[]; contexts: BrowserContext[]; events: string[] };

async function openTabs(browser: Browser, c: Case): Promise<Session> {
  const events: string[] = [];
  const contexts = [await openUser(browser, OWNER)];
  const tabs = [await openDocsTab(contexts[0]!, OWNER, "A", events)];
  if (c.tabs === "same") tabs.push(await openDocsTab(contexts[0]!, OWNER, "A2", events));
  if (c.tabs === "diff") {
    contexts.push(await openUser(browser, TEAMMATE));
    tabs.push(await openDocsTab(contexts[1]!, TEAMMATE, "B", events));
  }
  return { tabs, contexts, events };
}

/** Where the case's Doc is before the action (none before a create). */
function startOf(c: Case): string | null {
  if (c.action === "create" || c.action === "createTaken") return null;
  if (c.action === "restore" || c.action === "delete")
    return `${trashOf(home(OWNER))}/${c.name}.md`;
  return startPath(c);
}

/** Put a tab where the case needs it, and wait until it knows the Doc well enough to work offline. */
async function prepareTab(tab: Tab, view: View | "editor" | undefined, c: Case): Promise<void> {
  const start = startOf(c);
  // Docs keeps an offline cache once home has listed; the checks below read it.
  await expect.poll(async () => (await tabCache(tab)).missingDb, { timeout: 30_000 }).toBe(false);
  if (view === "editor") {
    await openEditor(tab, startPath(c));
  } else {
    await showView(tab, view ?? "All Docs");
    const visible = start && !(tab.user === TEAMMATE && start.startsWith(home(OWNER)));
    if (visible && view !== "Starred" && view !== "Shared with me") {
      await expect(row(tab, nameOf(start))).toBeVisible({ timeout: 30_000 });
    }
  }
  if (
    start &&
    !start.includes("/.Trash/") &&
    !(tab.user === TEAMMATE && start.startsWith(home(OWNER)))
  ) {
    await expect.poll(() => driveKnows(tab, start), { timeout: 60_000 }).toBe(true);
  }
}

async function hardRefresh(tabs: Tab[]): Promise<void> {
  for (const tab of tabs) {
    await tab.reload();
    await expect(tab.locator(".docs-home-pane, .ProseMirror").first()).toBeVisible({
      timeout: 60_000,
    });
  }
}

/** Server state of both users, for a failed check. */
async function explain(c: Case, error: unknown): Promise<never> {
  let message = String(error);
  for (const user of [OWNER, TEAMMATE]) {
    const s = await serverState(user, c).catch(() => null);
    if (s) message += `\nserver as ${user}: ${JSON.stringify(s)}`;
  }
  throw new Error(message);
}

async function cleanUp(c: Case): Promise<void> {
  const paths = new Set<string>();
  for (const user of [OWNER, TEAMMATE]) {
    const s = await serverState(user, c).catch(() => null);
    for (const p of [...(s?.active ?? []), ...(s?.trash ?? [])]) paths.add(p);
  }
  if (c.action === "share") await unshareQuietly(OWNER, startPath(c));
  await removeQuietly(OWNER, [...paths]);
  if (c.dest !== TEAM_ROOT && c.dest !== c.dir) await removeQuietly(OWNER, [c.dest]);
  // The Trash entries of the case, if the clean-up above trashed rather than deleted.
  const trash = await listFolder(OWNER, trashOf(home(OWNER))).catch(() => []);
  await removeQuietly(
    OWNER,
    trash.filter((name) => name.includes(c.id)).map((name) => `${trashOf(home(OWNER))}/${name}`),
  );
}

async function runCase(browser: Browser, c: Case): Promise<void> {
  const def: ActionDef = ACTIONS[c.action];
  let session: Session | null = null;
  try {
    await (def.seed ?? seedDoc)(c);
    session = await openTabs(browser, c);
    const all = session.tabs;
    const [a, b] = all as [Tab, Tab | undefined];
    await prepareTab(a, def.aView, c);
    if (b) await prepareTab(b, def.bView, c);

    const offline = { on: [], off: [a], both: all, aOff: [a], bOff: b ? [b] : [] }[c.net];
    for (const tab of offline) await setOffline(tab, true);
    await a.bringToFront();
    await def.run(a, b ?? null, c);
    // Gap 5: offline, nothing on screen says "Failed to fetch".
    for (const tab of offline) await expect(tab.getByText("Failed to fetch")).toHaveCount(0);
    for (const tab of offline) await setOffline(tab, false);

    await expect
      .poll(
        async () =>
          def.landed(
            await serverState(OWNER, c),
            c.tabs === "diff" ? await serverState(TEAMMATE, c) : null,
            c,
          ),
        { message: "the server holds the action", timeout: 45_000 },
      )
      .toBe(true)
      .catch((error: unknown) => explain(c, error));
    expect(await converge(all, c, 45_000), "every tab mirrors the server").toEqual({});

    // A hard refresh of every tab changes nothing, in any home view.
    await hardRefresh(all);
    expect(await converge(all, c, 20_000), "still in sync after a hard refresh").toEqual({});
    for (const tab of all) {
      if (await tab.locator(".ProseMirror").isVisible()) await tab.goto("/docs");
      await waitForHome(tab);
      const views: View[] = ["All Docs", "Starred", "Trash"];
      if (tab.user === TEAMMATE) views.push("Shared with me");
      for (const view of views) {
        await showView(tab, view);
        const want = expectedRows(await serverState(tab.user, c), view, tab.user);
        await expect
          .poll(() => listedRows(tab, c), { message: `${tab.tag} ${view}`, timeout: 20_000 })
          .toEqual(want);
      }
    }

    // Gap 4: "Changes synced" never showed while a tab was offline.
    for (const tab of all) {
      const early = await tab.evaluate(() =>
        (
          (window as unknown as { __toasts?: { text: string; online: boolean }[] }).__toasts ?? []
        ).filter((toast) => toast.text.includes("Changes synced") && !toast.online),
      );
      expect(early, `${tab.tag}: Changes synced while offline`).toEqual([]);
    }
  } finally {
    if (session) {
      // Offline, a page error may be expected: report them, do not fail on them.
      for (const event of session.events) {
        test.info().annotations.push({ type: "page error", description: event });
      }
      for (const context of session.contexts) await context.close().catch(() => undefined);
    }
    await cleanUp(c);
  }
}

// --- known bugs --------------------------------------------------------------------------------

/**
 * Open bugs this matrix found, by case title, as issue numbers. Such a case is
 * marked as expected to fail, so the run stays green and a fix shows up as
 * "expected to fail, but passed": then drop the entry.
 */
const BUGS: Record<string, number[]> = {};

function expectKnownBugs(title: string): void {
  const bugs = BUGS[title] ?? [];
  if (bugs.length === 0) return;
  for (const bug of bugs) test.info().annotations.push({ type: "issue", description: `#${bug}` });
  test.fail(true, `known bug ${bugs.map((bug) => `#${bug}`).join(", ")}`);
}

// --- the matrix --------------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  // A cold Vite dev server compiles each module on first request and may reload
  // the page; pay for that once, before the first case: home, then the editor.
  const path = `${home(OWNER)}/DM warm-up ${caseId()}.md`;
  await putDoc(OWNER, path, "# warm-up\n");
  const context = await openUser(browser, OWNER);
  try {
    const tab = await openDocsTab(context, OWNER, "warm-up", []);
    await openEditor(tab, path);
    await tab.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  } finally {
    await context.close().catch(() => undefined);
    await dav(OWNER, "DELETE", path).catch(() => undefined);
  }
});

for (const action of Object.keys(ACTIONS) as Action[]) {
  const nets: Nets = ACTIONS[action].nets;
  for (const tabs of Object.keys(nets) as Tabs[]) {
    for (const net of nets[tabs] ?? []) {
      const title = `${action} · ${tabs} · ${net}`;
      test(title, async ({ browser }) => {
        expectKnownBugs(title);
        const id = caseId();
        const shared = tabs === "diff" && action !== "move" && action !== "share";
        const dir = shared ? TEAM_ROOT : home(OWNER);
        await runCase(browser, {
          action,
          tabs,
          net,
          id,
          name: `DM ${action} ${tabs} ${net} ${id}`,
          dir,
          dest:
            action !== "move"
              ? dir
              : tabs === "diff"
                ? TEAM_ROOT
                : `${home(OWNER)}/DM folder ${id}`,
        });
      });
    }
  }
}
