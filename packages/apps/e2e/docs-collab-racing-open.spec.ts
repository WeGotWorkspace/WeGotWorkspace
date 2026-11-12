// Two people open one Doc at the same moment and both type at once (#2056).
//
// Found by the team simulation: typed straight after the editor shows, before the
// collaboration join and first sync are done, one person's line was lost, even from
// their own editor. Taking turns after both had joined always worked.
//
// Each round: a fresh Team Doc, owner and teammate open it together, each types a
// line at the end as soon as their editor takes input. Both lines must end up in
// both editors and in the file.
import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { openUser, OWNER, putDoc, readDoc, removeQuietly, TEAMMATE } from "./helpers/docs-matrix";
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

test.describe("Docs: two people open one document and type at once", () => {
  test("neither line is lost", async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    const paths: string[] = [];
    try {
      const owner = await openUser(browser, OWNER);
      const teammate = await openUser(browser, TEAMMATE);
      contexts.push(owner, teammate);

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

        await Promise.all([a.close(), b.close()]);
      }
    } finally {
      await removeQuietly(OWNER, paths);
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
