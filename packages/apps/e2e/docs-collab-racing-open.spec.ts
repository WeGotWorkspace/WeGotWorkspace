// Two people open one Doc at the same moment and both type at once (#2056).
//
// Found by the team simulation: typed straight after the editor shows, before the
// collaboration join and first sync are done, one person's line was lost, even from
// their own editor. Taking turns after both had joined always worked.
//
// Each round: a fresh Team Doc, owner and teammate open it together, each types a
// line at the end as soon as their editor takes input. Both lines must end up in
// both editors and in the file, and the document must stay in order: an editor
// that took typing while still empty put the line before the title.
//
// The second case lets only the teammate type (#2061). The owner, who only
// watches, must still see the line: a typing owner would itself trigger the
// exchange that brings its screen up to date and so hide a dead live link.
import { devices, expect, test, webkit, type BrowserContext, type Page } from "./helpers/live-test";
import {
  api,
  openUser,
  OWNER,
  putDoc,
  readDoc,
  removeQuietly,
  TEAMMATE,
} from "./helpers/docs-matrix";
import { docsUrlForFile } from "./helpers/docs-live";

const ROUNDS = Number(process.env.WGW_E2E_RACE_ROUNDS ?? 3);

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 60_000 + ROUNDS * 60_000 });

/** Wait for the editor to take input, put the caret at the very end, type a new line. */
async function typeAsSoonAsEditable(page: Page, line: string): Promise<void> {
  const editor = page.locator(".ProseMirror[contenteditable='true']").first();
  await editor.waitFor({ timeout: 30_000 });
  await editor.click();
  // Tiptap puts the editor on its root element; End/Ctrl+End do not reach the
  // document end on every platform.
  await page.evaluate(() => {
    const root = document.querySelector(".ProseMirror") as
      (HTMLElement & { editor?: { commands: { focus: (at: "end") => boolean } } }) | null;
    root?.editor?.commands.focus("end");
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type(line, { delay: 15 });
}

type EditorWindow = Window & { __racingOpenEditors?: number };

/**
 * Counts every editor the page mounts. A Doc that joins its room twice (first
 * under a fallback name, then under the person's own) mounts a second editor a
 * moment after the first showed, and keys typed in between are dropped.
 */
function countEditors(): void {
  const page = window as EditorWindow;
  page.__racingOpenEditors = 0;
  const seen = new WeakSet<Element>();
  new MutationObserver(() => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor || seen.has(editor)) return;
    seen.add(editor);
    page.__racingOpenEditors = (page.__racingOpenEditors ?? 0) + 1;
  }).observe(document, { subtree: true, childList: true });
}

async function editorsMounted(page: Page): Promise<number> {
  return page.evaluate(() => (window as EditorWindow).__racingOpenEditors ?? 0);
}

/** The document's text from the editor state: the DOM also holds other people's cursor labels. */
async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector(".ProseMirror") as
      | (HTMLElement & {
          editor?: { state: { doc: { textBetween: TextBetween; content: { size: number } } } };
        })
      | null;
    type TextBetween = (from: number, to: number, blockSeparator: string) => string;
    const doc = root?.editor?.state.doc;
    return doc ? doc.textBetween(0, doc.content.size, "\n").replace(/\u00a0/g, " ") : "";
  });
}

/** The document as "type:text" blocks, top to bottom. */
async function editorBlocks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type Block = { type: { name: string }; textContent: string };
    const root = document.querySelector(".ProseMirror") as
      | (HTMLElement & {
          editor?: { state: { doc: { forEach: (visit: (node: Block) => void) => void } } };
        })
      | null;
    const blocks: string[] = [];
    root?.editor?.state.doc.forEach((node) => {
      blocks.push(`${node.type.name}:${node.textContent.replace(/\u00a0/g, " ")}`);
    });
    return blocks;
  });
}

test.describe("Docs: two people open one document and type at once", () => {
  test("neither line is lost", async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const paths: string[] = [];
    try {
      const owner = await openUser(browser, OWNER);
      const teammate = await openUser(browser, TEAMMATE);
      contexts.push(owner, teammate);
      await Promise.all([owner.addInitScript(countEditors), teammate.addInitScript(countEditors)]);

      for (let round = 1; round <= ROUNDS; round += 1) {
        const stamp = `${Date.now()}-${round}`;
        const apiPath = `/groups/team/e2e-racing-open-${stamp}.md`;
        paths.push(apiPath);
        await putDoc(OWNER, apiPath, `# Racing open ${round}\n\nShared intro.\n`);
        const mine = `Owner line ${stamp}`;
        const theirs = `Teammate line ${stamp}`;

        const [a, b] = await Promise.all([owner.newPage(), teammate.newPage()]);
        await Promise.all([a.goto(docsUrlForFile(apiPath)), b.goto(docsUrlForFile(apiPath))]);
        await Promise.all([typeAsSoonAsEditable(a, mine), typeAsSoonAsEditable(b, theirs)]);

        for (const [page, who] of [
          [a, "owner"],
          [b, "teammate"],
        ] as const) {
          await expect
            .poll(() => editorText(page), {
              timeout: 30_000,
              message: `round ${round}: ${who}'s editor holds both lines`,
            })
            .toEqual(expect.stringContaining(mine));
          await expect
            .poll(() => editorText(page), {
              timeout: 30_000,
              message: `round ${round}: ${who}'s editor holds both lines`,
            })
            .toEqual(expect.stringContaining(theirs));
        }
        await expect
          .poll(
            async () => {
              const saved = (await readDoc(OWNER, apiPath)) ?? "";
              return { owner: saved.includes(mine), teammate: saved.includes(theirs) };
            },
            { timeout: 30_000, message: `round ${round}: the file holds both lines` },
          )
          .toEqual({ owner: true, teammate: true });

        // In order on both screens: title first and whole, the intro untouched after it.
        const title = `heading:Racing open ${round}`;
        await expect
          .poll(async () => (await editorBlocks(a)).slice(0, 2), {
            timeout: 30_000,
            message: `round ${round}: the title and intro stay on top`,
          })
          .toEqual([title, "paragraph:Shared intro."]);
        await expect
          .poll(async () => editorBlocks(b), {
            timeout: 30_000,
            message: `round ${round}: both screens show the same document`,
          })
          .toEqual(await editorBlocks(a));

        // The room is joined once: the editor is not swapped under the person's hands.
        expect(
          { owner: await editorsMounted(a), teammate: await editorsMounted(b) },
          `round ${round}: the editor that first showed is the only one`,
        ).toEqual({ owner: 1, teammate: 1 });

        await Promise.all([a.close(), b.close()]);
      }
    } finally {
      await removeQuietly(OWNER, paths);
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

/** A second Team for both users: two workspace rooms, as on a real install (#2061). */
const SECOND_TEAM = "e2e-racing-team";

async function ensureSecondTeam(): Promise<void> {
  await api(OWNER, "POST", "/admin/groups", { slug: SECOND_TEAM, displayName: "E2E Racing Team" });
  await api(OWNER, "PUT", `/admin/groups/${SECOND_TEAM}/members/${OWNER}`);
  await api(OWNER, "PUT", `/admin/groups/${SECOND_TEAM}/members/${TEAMMATE}`);
}

test.describe("Docs: two people open one document, only one types", () => {
  test("the person who only watches sees the other's line (#2061)", async ({ browser }) => {
    // `WGW_E2E_RACE_OWNER_ENGINE=webkit` runs the owner as a phone-sized WebKit,
    // the pairing that found #2061; the default stays Chromium.
    const phone = process.env.WGW_E2E_RACE_OWNER_ENGINE === "webkit" ? await webkit.launch() : null;
    const paths: string[] = [];
    try {
      await ensureSecondTeam();
      for (let round = 1; round <= ROUNDS; round += 1) {
        const stamp = `${Date.now()}-${round}`;
        const apiPath = `/groups/team/e2e-racing-watch-${stamp}.md`;
        paths.push(apiPath);
        await putDoc(OWNER, apiPath, `# Racing watch ${round}\n\nShared intro.\n`);
        const theirs = `Teammate line ${stamp}`;

        // Cold start every round: no tab of either person is open yet.
        const owner = await openUser(phone ?? browser, OWNER);
        const teammate = await openUser(browser, TEAMMATE);
        try {
          const a = await owner.newPage();
          if (phone) await a.setViewportSize(devices["iPhone 13"].viewport);
          await a.goto(docsUrlForFile(apiPath));
          await new Promise((resolve) => setTimeout(resolve, 800));
          const b = await teammate.newPage();
          await b.goto(docsUrlForFile(apiPath));
          await typeAsSoonAsEditable(b, theirs);

          await expect
            .poll(async () => (await readDoc(OWNER, apiPath)) ?? "", {
              timeout: 30_000,
              message: `round ${round}: the file holds the teammate's line`,
            })
            .toContain(theirs);
          await expect
            .poll(() => editorText(a), {
              timeout: 20_000,
              message: `round ${round}: the owner, who does not type, sees the teammate's line`,
            })
            .toContain(theirs);
        } finally {
          await Promise.all([owner.close(), teammate.close()]);
        }
      }
    } finally {
      await removeQuietly(OWNER, paths);
      // Later specs on this server expect only the default Team between the two.
      await api(OWNER, "DELETE", `/admin/groups/${SECOND_TEAM}`);
      await phone?.close();
    }
  });
});
