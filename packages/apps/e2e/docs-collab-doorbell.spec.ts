// A lone peer sees a newcomer through the push doorbell, not the 30 s heartbeat (#2294).
//
// A quiet room does not poll while push is connected (the push read keeps its peer
// alive, #2287); before that it polled every 30 s. The existing specs wait 20 to 90 s,
// so they would pass on a heartbeat alone. Here the owner must see each line
// within 10 s: when the teammate first opens the Doc, after the teammate reloads, and
// right after the owner comes back online (the ring that arrives with the response
// that reconnects push must not be pushed back to the heartbeat).
import { expect, test, type Page } from "./helpers/live-test";
import { openUser, OWNER, putDoc, removeQuietly, TEAMMATE } from "./helpers/docs-matrix";
import { docsUrlForFile } from "./helpers/docs-live";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 120_000 });

const SEEN_WITHIN_MS = 10_000;

async function typeAtEnd(page: Page, line: string): Promise<void> {
  const editor = page.locator(".ProseMirror[contenteditable='true']").first();
  await editor.waitFor({ timeout: 30_000 });
  await editor.click();
  await page.evaluate(() => {
    const root = document.querySelector(".ProseMirror") as
      (HTMLElement & { editor?: { commands: { focus: (at: "end") => boolean } } }) | null;
    root?.editor?.commands.focus("end");
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type(line, { delay: 15 });
}

async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector(".ProseMirror") as
      | (HTMLElement & {
          editor?: {
            state: {
              doc: {
                textBetween: (from: number, to: number, sep: string) => string;
                content: { size: number };
              };
            };
          };
        })
      | null;
    const doc = root?.editor?.state.doc;
    return doc ? doc.textBetween(0, doc.content.size, "\n").replace(/\u00a0/g, " ") : "";
  });
}

test.describe("Docs: a lone peer sees a newcomer through the doorbell", () => {
  test("first join, reload and back online each show within 10 s", async ({ browser }) => {
    const stamp = Date.now();
    const apiPath = `/groups/team/e2e-doorbell-${stamp}.md`;
    const owner = await openUser(browser, OWNER);
    const teammate = await openUser(browser, TEAMMATE);
    try {
      await putDoc(OWNER, apiPath, "# Doorbell\n\nShared intro.\n");
      const a = await owner.newPage();
      await a.goto(docsUrlForFile(apiPath));
      await expect(a.locator(".ProseMirror")).toContainText("Shared intro.", { timeout: 30_000 });
      // Alone: push connects and the room settles on the heartbeat.
      await a.waitForTimeout(5_000);

      const seen = (line: string) =>
        expect
          .poll(() => editorText(a), { timeout: SEEN_WITHIN_MS, message: `owner sees ${line}` })
          .toContain(line);

      const b = await teammate.newPage();
      await b.goto(docsUrlForFile(apiPath));
      const first = `Teammate first ${stamp}`;
      await typeAtEnd(b, first);
      await seen(first);

      await b.reload();
      const second = `Teammate second ${stamp}`;
      await typeAtEnd(b, second);
      await seen(second);

      await owner.setOffline(true);
      await a.waitForTimeout(4_000);
      const third = `Teammate third ${stamp}`;
      await typeAtEnd(b, third);
      await owner.setOffline(false);
      await seen(third);
    } finally {
      await removeQuietly(OWNER, [apiPath]);
      await Promise.all([owner.close(), teammate.close()]);
    }
  });
});
