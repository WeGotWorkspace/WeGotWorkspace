// The push read keeps a quiet Docs room alive past the peer timeout (#2287).
//
// Behind the push doorbell a quiet room does not poll: the push read names this
// browser's peers (`X-WGW-Rtc-Peers`) and the server refreshes them. A background
// tab's peers reach that header only through `localStorage`, so this spec leaves a
// second tab on another Doc quiet for longer than the 90 s collab peer timeout and
// then checks that a teammate still finds the owner there.
import { expect, test, type Page, type Request } from "./helpers/live-test";
import { openUser, OWNER, putDoc, removeQuietly, TEAMMATE } from "./helpers/docs-matrix";
import { docsUrlForFile } from "./helpers/docs-live";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 240_000 });

/** Longer than the collab peer timeout (90 s). */
const QUIET_MS = 100_000;

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

const isRoomPoll = (request: Request) =>
  request.method() === "GET" && /\/api\/v1\/rooms\/f_[^/]+\/events/.test(request.url());

const isPushRead = (request: Request) => request.url().includes("/api/v1/jmap/events/");

test.describe("Docs: the push read is the room heartbeat", () => {
  test("a background tab's quiet room stays on the roster past the peer timeout", async ({
    browser,
  }) => {
    const stamp = Date.now();
    const front = `/groups/team/e2e-heartbeat-front-${stamp}.md`;
    const back = `/groups/team/e2e-heartbeat-back-${stamp}.md`;
    const owner = await openUser(browser, OWNER);
    const teammate = await openUser(browser, TEAMMATE);
    try {
      await putDoc(OWNER, front, "# Front\n\nFront intro.\n");
      await putDoc(OWNER, back, "# Back\n\nBack intro.\n");

      const tab1 = await owner.newPage();
      await tab1.goto(docsUrlForFile(front));
      await expect(tab1.locator(".ProseMirror")).toContainText("Front intro.", { timeout: 30_000 });
      const tab2 = await owner.newPage();
      await tab2.goto(docsUrlForFile(back));
      await expect(tab2.locator(".ProseMirror")).toContainText("Back intro.", { timeout: 30_000 });
      await tab1.bringToFront();

      const backRoomPolls: number[] = [];
      tab2.on("request", (request) => {
        if (isRoomPoll(request)) backRoomPolls.push(Date.now());
      });
      const namedPeers: string[] = [];
      owner.on("request", (request) => {
        if (!isPushRead(request)) return;
        namedPeers.push(request.headers()["x-wgw-rtc-peers"] ?? "");
      });

      // Push connects and both rooms settle; the push read names both tabs' collab peers.
      await expect
        .poll(() => namedPeers.at(-1)?.match(/collab:/g)?.length ?? 0, {
          timeout: 30_000,
          message: "push reads name both tabs' collab peers",
        })
        .toBeGreaterThanOrEqual(2);
      await tab1.waitForTimeout(5_000);

      backRoomPolls.length = 0;
      const pushReadsBefore = namedPeers.length;
      const quietFrom = Date.now();
      await tab1.waitForTimeout(QUIET_MS);

      // No steady poll from the quiet room: a 30 s heartbeat would poll at least 3
      // times here. A ring (any room change of this user, such as the teammate's
      // presence) still makes it poll once, so allow two.
      console.log(
        "back room polls at (s):",
        backRoomPolls.map((at) => Math.round((at - quietFrom) / 1000)),
      );
      expect(backRoomPolls.length).toBeLessThanOrEqual(2);
      const quietReads = namedPeers.slice(pushReadsBefore);
      expect(quietReads.length).toBeGreaterThan(10);
      expect(quietReads.every((value) => (value.match(/collab:/g)?.length ?? 0) >= 2)).toBe(true);

      // The teammate still finds the owner in the quiet room: their line reaches tab 2.
      const page = await teammate.newPage();
      await page.goto(docsUrlForFile(back));
      const line = `Teammate after the quiet ${stamp}`;
      await typeAtEnd(page, line);
      await expect(tab2.locator(".ProseMirror")).toContainText(line, { timeout: 10_000 });
    } finally {
      await removeQuietly(OWNER, [front, back]);
      await Promise.all([owner.close(), teammate.close()]);
    }
  });
});
