// Browser flows for the studio's Google background: habits a person tries in
// the web apps and imports of their Google export through the screens. Habits
// and import types without a browser flow run through the API executors.
import { cpSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { need } from "../api/collab.mjs";
import { HarnessDoubt } from "../doubt.mjs";
import { putNew } from "../api/files.mjs";
import { TAKEOUT_DIR, driveTree, googleExecutors, walk } from "../api/google.mjs";
import { T, online, openDoc, openDriveFolder, settle, typeAtEnd, waitSaved } from "./actions.mjs";

const habitFriction = (ctx, a, what, workaround) => ctx.friction?.({ what, workaround, source: "habit", habit: a.params.habit });
const migrationFriction = (ctx, a, what, workaround) => ctx.friction?.({ what, workaround, source: "migration", importType: a.params.type });
const firstName = (ctx, p) => ctx.world.persona(p).displayName.split(" ")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function docText(ctx, persona, path) {
  const res = await ctx.client(persona).request("GET", `/api/v1/files/content?path=${encodeURIComponent(path)}`, { headers: { accept: "*/*" } });
  return res.ok ? res.text : "";
}

/** A folder from the Google export, copied under the run dir so the browser can pick it as a directory. */
function stageFolder(ctx, a) {
  const name = `Uit Google ${a.persona} ${a.n}`;
  const dir = join(ctx.runDir ?? "/tmp", "takeout", String(a.n), name);
  mkdirSync(dir, { recursive: true });
  cpSync(join(TAKEOUT_DIR, "folder"), dir, { recursive: true });
  return { name, dir, want: walk(dir).map(([d, n]) => (d ? `${d}/${n}` : n)).sort() };
}

async function dropFolder(b, a, ctx) {
  const folder = need(ctx, a.params.folder).ids.path;
  const { name, dir, want } = stageFolder(ctx, a);
  await openDriveFolder(b, ctx, folder);
  const input = b.page.locator('input[type="file"][aria-label="Upload folder"]');
  if (!(await input.count())) {
    habitFriction(ctx, a, "Drive has no way to upload a folder with its subfolders", "created the folders by hand and uploaded file by file");
    throw new Error("no folder upload in Drive");
  }
  await input.setInputFiles(dir);
  const root = `${folder}/${name}`;
  let tree = [];
  await b.wait("folder upload finished", async () => {
    for (let i = 0; i < 40; i += 1) {
      tree = await driveTree(ctx, a.persona, root);
      if (want.every((f) => tree.includes(f))) return;
      await sleep(3000);
    }
  });
  const missing = want.filter((f) => !tree.includes(f));
  if (missing.length) throw new Error(`dropped a folder of ${want.length} files from the Google export; after 2 min Drive has ${want.length - missing.length} (missing ${missing.slice(0, 3).join(", ")})`);
  return { ids: { path: root }, extra: { files: want.length }, note: `folder with ${want.length} files in ${new Set(want.map((f) => f.split("/").slice(0, -1).join("/"))).size} subfolders` };
}

const HABITS = {
  /** Google: suggesting mode, the author accepts. A new paragraph is suggested on half the days, a sentence on the rest. */
  async "suggest-edit"(b, a, ctx) {
    const doc = need(ctx, a.params.doc);
    const { page } = b;
    await openDoc(b, doc.ids.path);
    const suggest = page.getByRole("button", { name: "Suggest", exact: true });
    if (!(await suggest.waitFor({ timeout: 8000 }).then(() => true, () => false))) {
      habitFriction(ctx, a, "Docs has no suggestion mode", "wrote the proposed text in a comment");
      throw new Error("no Suggest button in Docs");
    }
    await suggest.click();
    const text = `Voorstel ${firstName(ctx, a.persona)}: ${a.params.text}`;
    const editor = page.locator(".ProseMirror").first();
    if (a.params.paragraph) await typeAtEnd(page, editor, text);
    else {
      await editor.click({ timeout: T });
      await editor.evaluate((el) => {
        const sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
      });
      await page.keyboard.insertText(` ${text}`);
    }
    await waitSaved(b, page);
    await settle(page, 3000);
    // The author opens the doc, finds the suggestion in the Review panel and accepts it.
    const author = await ctx.extraBrowser(a.params.author);
    try {
      await openDoc(author, doc.ids.path);
      const panel = author.page.getByRole("complementary", { name: "Review" });
      if (!(await panel.isVisible())) await author.page.getByRole("button", { name: /^Show review/ }).first().click({ timeout: T });
      const cards = panel.getByRole("article").filter({ hasText: text.slice(0, 40) });
      await b.wait("suggestion reached the author", () => cards.first().waitFor({ timeout: 30000 }));
      const shown = await cards.count();
      await cards.first().getByRole("button", { name: "Accept suggestion" }).click({ timeout: T });
      await settle(author.page, 2000);
      await waitSaved(author, author.page);
      let saved = "";
      for (let i = 0; i < 10 && !saved.includes(text.slice(0, 30)); i += 1) {
        saved = await docText(ctx, a.persona, doc.ids.path);
        if (!saved.includes(text.slice(0, 30))) await sleep(3000);
      }
      if (!saved.includes(text.slice(0, 30))) {
        const left = await panel.getByRole("article").filter({ hasText: text.slice(0, 40) }).count();
        throw new Error(`${a.params.author} accepted ${firstName(ctx, a.persona)}'s suggested ${a.params.paragraph ? "paragraph" : "sentence"}, but it is not in the saved doc after 30 s (${shown} review card(s) before accepting, ${left} after)`);
      }
      return { note: `${a.params.author} accepted the suggested ${a.params.paragraph ? "paragraph" : "sentence"}${shown > 1 ? ` (shown as ${shown} review cards)` : ""}` };
    } finally {
      await author.close();
    }
  },

  /** Google: a client link with an expiry date. */
  async "expiring-link"(b, a, ctx) {
    const file = need(ctx, a.params.file);
    const path = file.ids.path;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const { page } = b;
    await openDriveFolder(b, ctx, path.slice(0, path.lastIndexOf("/")));
    // Each file in the list has its own "More actions" button right after it.
    const row = page.getByRole("region", { name: "Files" }).getByRole("button", { name, exact: true }).first();
    await row.locator("xpath=following::button[@aria-label='More actions' or @title='More actions' or normalize-space(.)='More actions'][1]").click({ timeout: T });
    await page.getByRole("menuitem", { name: /Share/ }).first().click({ timeout: T });
    const dialog = page.getByRole("dialog", { name: /^Share / });
    await dialog.waitFor({ timeout: T });
    const linkSwitch = dialog.getByRole("switch", { name: "Public link" });
    if (!(await linkSwitch.isChecked())) await linkSwitch.click();
    await settle(page, 1500);
    const expiry = dialog.getByLabel(/expir|verloop|until|valid/i).or(dialog.getByRole("button", { name: /expir|verloop/i }));
    const hasExpiry = await expiry.count();
    if (!hasExpiry) habitFriction(ctx, a, "A share link cannot be given an expiry date in Drive", "shared a password-protected link and noted to remove it later");
    await settle(page, 1500);
    const shares = await ctx.client(a.persona).request("GET", `/api/v1/files/shares/at-path?path=${encodeURIComponent(path)}`);
    const pub = JSON.stringify(shares.json ?? {}).includes('"kind":"public"');
    if (!pub) throw new Error("switched on Public link in the Share dialog, but the server has no public link for the file");
    const done = dialog.getByRole("button", { name: /^(Done|Close)$/ });
    if (await done.count()) await done.first().click();
    else await page.keyboard.press("Escape");
    return { extra: { expiry: !!hasExpiry }, note: hasExpiry ? "link with an expiry date" : "password-protected link without an expiry date" };
  },

  /** Google: open a planning sheet in the browser and read it. */
  async "sheet-open"(b, a, ctx) {
    const folder = need(ctx, a.params.folder).ids.path;
    const name = "Planning Q4 (Google Sheets export).xlsx";
    const path = await putNew(ctx.client(a.persona), ctx.origin, folder, name, readFileSync(join(TAKEOUT_DIR, name)));
    const shown = path.slice(path.lastIndexOf("/") + 1);
    const { page } = b;
    await openDriveFolder(b, ctx, folder);
    await page.getByRole("button", { name: shown, exact: true }).first().dblclick({ timeout: T });
    await settle(page, 4000);
    // A preview would show the sheet's cells; "Concept presenteren" is a whole cell there and nowhere else in Drive.
    const readable = await page.getByText("Concept presenteren", { exact: true }).first().isVisible().catch(() => false);
    if (!readable) habitFriction(ctx, a, "Drive cannot show a spreadsheet (.xlsx) in the browser", "downloaded it to open on the desk");
    return { ids: { path }, extra: { name: shown, bytes: statSync(join(TAKEOUT_DIR, name)).size, readable }, note: readable ? "sheet shown in the browser" : "only the file details, no preview" };
  },

  "folder-drop": dropFolder,
};

const IMPORTS = {
  /** Docs → More create options → Import docx file(s): the browser converts it and reports what did not come across. */
  async docx(b, a, ctx) {
    const folder = need(ctx, a.params.folder).ids.path;
    const { page } = b;
    const name = "Briefing Noordlicht (Google Docs export).docx";
    await b.open("/docs", () => page.getByRole("button", { name: "More create options" }).waitFor({ timeout: T }));
    await page.getByRole("button", { name: "More create options" }).click();
    const chooser = page.waitForEvent("filechooser", { timeout: T });
    await page.getByRole("menuitem", { name: /Import docx/ }).click({ timeout: T });
    await (await chooser).setFiles(join(TAKEOUT_DIR, name));
    const dialog = page.getByRole("dialog", { name: /Import docx/ });
    await dialog.waitFor({ timeout: T });
    const title = `Briefing uit Google ${a.persona} ${a.n}`;
    await dialog.getByRole("textbox", { name: "Name" }).fill(title);
    // Location: the picker starts in Personal; go up to Drives, then down to the Team and the project folder.
    await dialog.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Drives" }).click({ timeout: T });
    await settle(page, 800);
    for (const seg of folder.split("/").filter(Boolean).slice(1)) {
      const label = ctx.world.teams.find((t) => t.id === seg)?.name ?? seg;
      // A row is named by the folder and its date ("Noordlicht launch 00:47").
      const row = dialog.getByRole("row", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`) }).first();
      await row.waitFor({ timeout: 10000 }).catch(() => {
        throw new HarnessDoubt(`the import's folder picker has no "${label}"`);
      });
      await row.dblclick();
      await settle(page, 800);
    }
    // The current folder is the location; Import stays disabled while a row is only highlighted.
    const importBtn = dialog.getByRole("button", { name: "Import" });
    if (await importBtn.isDisabled()) await page.keyboard.press("Escape").catch(() => {});
    await importBtn.click({ timeout: T });
    const report = page.getByRole("dialog", { name: /did not come across/ });
    const reported = await report.waitFor({ timeout: 20000 }).then(() => true, () => false);
    let lost = [];
    if (reported) {
      lost = (await report.getByRole("listitem").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      if (lost.some((t) => /comment/i.test(t))) migrationFriction(ctx, a, "Comments in a Google Docs export are dropped when it becomes a doc", "copied the comments into the doc by hand");
      await report.getByRole("button", { name: "OK" }).click();
    }
    await page.locator(".ProseMirror").first().waitFor({ timeout: T });
    await online(page);
    await waitSaved(b, page);
    // Docs opens the new doc by id; it should be in the chosen folder under the chosen name.
    const path = `${folder}/${title}.md`;
    let text = "";
    for (let i = 0; i < 10 && !text; i += 1) {
      text = await docText(ctx, a.persona, path);
      if (!text) await sleep(2000);
    }
    if (!text) throw new Error(`imported the .docx as "${title}" into ${folder}, but there is no ${title}.md there after 20 s`);
    const missing = ["Briefing Noordlicht launch", "Deadline: 12 december"].filter((t) => !text.includes(t));
    if (missing.length) throw new Error(`the doc made from the Google Docs export lost its text: ${missing.join(", ")}`);
    return { ids: { path }, extra: { name: title, lost }, note: lost.length ? `did not come across: ${lost.join(", ")}` : "everything came across" };
  },

  folder: dropFolder,
};

export const uiGoogle = {
  async habit(b, a, ctx) {
    const fn = HABITS[a.params.habit];
    if (!fn) {
      const r = await googleExecutors.habit({ ...a, layer: "api" }, ctx);
      return { ...r, note: [r?.note, "no browser flow; ran through the API"].filter(Boolean).join("; ") };
    }
    const r = await fn(b, a, ctx);
    return { ...r, extra: { ...(r?.extra ?? {}), habit: a.params.habit } };
  },
  async "migrate.import"(b, a, ctx) {
    const fn = IMPORTS[a.params.type];
    if (!fn) {
      const r = await googleExecutors["migrate.import"]({ ...a, layer: "api" }, ctx);
      return { ...r, note: [r?.note, "no browser flow; ran through the API"].filter(Boolean).join("; ") };
    }
    return fn(b, a, ctx);
  },
};

