import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { nameBox } from "./helpers";

/**
 * Spike 7 variant C measurement (not part of the normal run): how often does a
 * finger that means to scroll arm a hold-drag instead?
 *   HOLD=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-hold.spec.ts \
 *     --project=android-phone --project=android-tablet --project=iphone --project=ipad --workers=1
 * A gesture: finger down, still for `pause` ms, then straight up at `speed` px/s
 * (the page scrolls down), then lift. Chromium gets real touch input through CDP,
 * so the browser's own pan arbitration takes part; WebKit gets synthetic touch
 * PointerEvents timed in the page (our timing logic only, no native pan).
 * Results append to docs/spike-7-touch/hold-results.json.
 */
test.skip(!process.env.HOLD, "set HOLD=1");
test.setTimeout(1_800_000);

const HOLDS = [160, 250, 350];
const SLOPS = [10, 4];
const PAUSES = [0, 80, 150, 250];
const SPEEDS = [2000, 300, 100, 50, 25];
const REPS = 2;

type Outcome = "pan" | "select" | "menu" | "none";
type Row = { project: string; holdMs: number; slop: number; pause: number; speed: number; outcome: Outcome; scrolled: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(page: Page, holdMs: number, slop: number) {
  await page.goto(`/iframe.html?id=spike-7-touch--frozen-c&viewMode=story&args=holdMs:${holdMs};holdSlop:${slop}`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
  await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
}

async function chromiumGesture(cdp: CDPSession, x: number, y: number, pause: number, speed: number, dist: number) {
  const send = (type: string, pts: { x: number; y: number }[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ ...p, id: i })) } as never);
  await send("touchStart", [{ x, y }]);
  if (pause) await sleep(pause);
  const t0 = Date.now();
  const dur = (dist / speed) * 1000;
  for (;;) {
    const t = Date.now() - t0;
    const d = Math.min(dist, (speed * t) / 1000);
    await send("touchMove", [{ x, y: y - d }]);
    if (d >= dist) break;
    await sleep(Math.min(8, Math.max(1, dur - t)));
  }
  await send("touchEnd", []);
}

async function webkitGesture(page: Page, x: number, y: number, pause: number, speed: number, dist: number) {
  await page.evaluate(
    ({ x, y, pause, speed, dist }) =>
      new Promise<void>((done) => {
        const target = document.elementFromPoint(x, y)!;
        const fire = (type: string, py: number) =>
          target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 78, pointerType: "touch", isPrimary: true, clientX: x, clientY: py, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
        fire("pointerdown", y);
        const start = performance.now() + pause;
        const step = () => {
          const t = performance.now() - start;
          if (t < 0) return void setTimeout(step, 4);
          const d = Math.min(dist, (speed * t) / 1000);
          fire("pointermove", y - d);
          if (d >= dist) {
            fire("pointerup", y - d);
            done();
          } else setTimeout(step, 8);
        };
        setTimeout(step, 4);
      }),
    { x, y, pause, speed, dist },
  );
}

test("accidental hold-drag while scrolling", async ({ page, browserName }, info) => {
  const chromium = browserName === "chromium";
  const rows: Row[] = [];
  for (const holdMs of HOLDS) {
    for (const slop of SLOPS) {
      await open(page, holdMs, slop);
      let cdp = chromium ? await page.context().newCDPSession(page) : null;
      for (const pause of PAUSES) {
        for (const speed of SPEEDS) {
          for (let rep = 0; rep < REPS; rep += 1) {
            const grid = page.getByTestId("grid");
            await grid.evaluate((el) => (el.scrollTop = 600));
            await page.waitForTimeout(80);
            const before = await nameBox(page);
            const top0 = await grid.evaluate((el) => el.scrollTop);
            const g = (await grid.boundingBox())!;
            const x = g.x + Math.min(g.width - 40, 200);
            const y = g.y + g.height * 0.6;
            const dist = speed >= 300 ? 200 : 48;
            if (cdp) await chromiumGesture(cdp, x, y, pause, speed, dist);
            else await webkitGesture(page, x, y, pause, speed, dist);
            await page.waitForTimeout(chromium && speed >= 300 ? 400 : 60);
            const menu = await page.getByRole("menu").count();
            const after = await nameBox(page);
            const scrolled = Math.round((await grid.evaluate((el) => el.scrollTop)) - top0);
            const outcome: Outcome = menu ? "menu" : after !== before ? "select" : scrolled !== 0 ? "pan" : "none";
            rows.push({ project: info.project.name, holdMs, slop, pause, speed, outcome, scrolled });
            if (outcome === "menu" || outcome === "select") {
              await cdp?.detach().catch(() => {});
              await open(page, holdMs, slop);
              if (cdp) cdp = await page.context().newCDPSession(page);
            }
          }
        }
      }
      await cdp?.detach().catch(() => {});
    }
  }
  const file = "docs/spike-7-touch/hold-results.json";
  mkdirSync("docs/spike-7-touch", { recursive: true });
  let prev: { runs: Row[] } = { runs: [] };
  try {
    prev = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* first project */
  }
  const runs = [...prev.runs.filter((r) => r.project !== info.project.name), ...rows];
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), runs }, null, 2));
  // Matrix: accidents (select or menu) out of REPS, per hold × slop × pause × speed.
  const summary: Record<string, string> = {};
  for (const r of rows) {
    const k = `${r.holdMs}ms/${r.slop}px p${r.pause}`;
    const bad = r.outcome === "select" || r.outcome === "menu";
    summary[k] = (summary[k] ?? "") + (bad ? (r.outcome === "menu" ? "M" : "S") : r.outcome === "pan" ? "." : "·");
  }
  console.log(info.project.name, `speeds ${SPEEDS.join("/")} px/s, ${REPS} reps each`);
  console.table(summary);
});
