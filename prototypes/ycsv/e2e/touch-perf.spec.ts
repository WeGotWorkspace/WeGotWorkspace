import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Spike 7 measurement (not part of the normal run): momentum scrolling and pinch
 * at 10k rows on Pixel 7 emulation, with CPU throttling to approximate a phone.
 *   PERF=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-perf.spec.ts --project=touch-perf
 * Frame gaps come from rAF on the main thread; "blank" counts frames where the
 * rendered rows did not cover the rows scrollTop says are visible.
 */
test.skip(!process.env.PERF, "set PERF=1");
test.setTimeout(600_000);

type Run = { cpu: number; overscan: number; kind: string; frames: number; fps: number; p95: number; worst: number; over20: number; blank: number; longTasks: number; scrolled: number };

test("momentum scroll and pinch at 10k rows", async ({ page }) => {
  const results: Run[] = [];
  for (const cpu of [1, 4, 6]) {
    for (const overscan of [4, 12, 30]) {
      await page.goto(`/iframe.html?id=spike-7-touch--ten-thousand-rows&viewMode=story&args=overscan:${overscan}`);
      await expect(page.getByTestId("grid")).toBeVisible();
      await page.evaluate(() => {
        localStorage.removeItem("ycsv-grid-zoom");
        const w = window as unknown as { __long: number };
        w.__long = 0;
        new PerformanceObserver((l) => (w.__long += l.getEntries().length)).observe({ type: "longtask", buffered: false });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      const g = (await page.getByTestId("grid").boundingBox())!;
      const at = { x: g.x + g.width / 2, y: g.y + g.height * 0.7 };
      for (const [kind, dy] of [
        ["fling down", -2500],
        ["fling down", -2500],
        ["fling up", 2500],
      ] as const) {
        await page.evaluate(() => {
          window.__touchHud?.reset();
          (window as unknown as { __long: number }).__long = 0;
        });
        const top0 = await page.getByTestId("grid").evaluate((el) => el.scrollTop);
        await cdp.send("Input.synthesizeScrollGesture", { x: at.x, y: at.y, yDistance: dy, speed: 6000, gestureSourceType: "touch", preventFling: false });
        // Wait for the fling to end (scrollTop stable for 400 ms).
        let last = -1;
        for (let i = 0; i < 40; i += 1) {
          await page.waitForTimeout(200);
          const t = await page.getByTestId("grid").evaluate((el) => el.scrollTop);
          if (t === last) break;
          last = t;
        }
        await page.waitForTimeout(400);
        const hud = await page.evaluate(() => ({ ...window.__touchHud!, long: (window as unknown as { __long: number }).__long }));
        results.push({ cpu, overscan, kind, frames: hud.frames, fps: hud.fps, p95: hud.p95, worst: hud.worst, over20: hud.over20, blank: hud.gaps, longTasks: hud.long, scrolled: Math.round(Math.abs(last - top0)) });
      }
      // Pinch: zoom in and out once, frame gaps measured by a rAF recorder.
      await page.evaluate(() => {
        const w = window as unknown as { __gaps: number[]; __stop: boolean };
        w.__gaps = [];
        w.__stop = false;
        let prev = 0;
        const tick = (t: number) => {
          if (prev) w.__gaps.push(t - prev);
          prev = t;
          if (!w.__stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        (window as unknown as { __long: number }).__long = 0;
      });
      const c = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      const pts = (d: number) => [
        { x: c.x - d / 2, y: c.y, id: 0 },
        { x: c.x + d / 2, y: c.y, id: 1 },
      ];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(100) });
      for (let i = 1; i <= 20; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(100 + i * 6) });
      for (let i = 1; i <= 20; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(220 - i * 8) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      const pinch = await page.evaluate(() => {
        const w = window as unknown as { __gaps: number[]; __stop: boolean; __long: number };
        w.__stop = true;
        const g = w.__gaps.slice(1);
        const s = [...g].sort((a, b) => a - b);
        return { frames: g.length, fps: Math.round((g.length / g.reduce((a, b) => a + b, 0)) * 1000), p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), worst: Math.round(s[s.length - 1] ?? 0), over20: g.filter((x) => x > 20).length, long: w.__long };
      });
      results.push({ cpu, overscan, kind: "pinch", ...pinch, blank: 0, longTasks: pinch.long, scrolled: 0 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await cdp.detach();
    }
  }
  console.table(results);
  mkdirSync("docs/spike-7-touch", { recursive: true });
  writeFileSync("docs/spike-7-touch/perf-results.json", JSON.stringify({ at: new Date().toISOString(), device: "Pixel 7 emulation, headless Chromium", results }, null, 2));
});

/**
 * Variant C next to B at 10k rows: flings (does the extra non-passive hold
 * check cost frames?) and a hold-drag range selection that rests on the bottom
 * edge for 2 s (edge auto-scroll while the selection grows).
 *   PERF=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-perf.spec.ts --project=touch-perf -g "variant C"
 */
test("variant C next to B: flings and a hold-drag into the edge", async ({ page }) => {
  type R = { variant: string; cpu: number; kind: string; frames: number; fps: number; p95: number; worst: number; over20: number; blank: number; scrolled: number };
  const results: R[] = [];
  const rec = () =>
    page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __stop: boolean };
      w.__gaps = [];
      w.__stop = false;
      let prev = 0;
      const tick = (t: number) => {
        if (prev) w.__gaps.push(t - prev);
        prev = t;
        if (!w.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const stop = () =>
    page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __stop: boolean };
      w.__stop = true;
      const g = w.__gaps.slice(1);
      const s = [...g].sort((a, b) => a - b);
      return { frames: g.length, fps: Math.round((g.length / g.reduce((a, b) => a + b, 0)) * 1000), p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), worst: Math.round(s[s.length - 1] ?? 0), over20: g.filter((x) => x > 20).length };
    });
  for (const cpu of [1, 4]) {
    for (const [variant, story] of [
      ["b", "ten-thousand-rows"],
      ["c", "ten-thousand-rows-c"],
    ] as const) {
      await page.goto(`/iframe.html?id=spike-7-touch--${story}&viewMode=story`);
      await expect(page.getByTestId("grid")).toBeVisible();
      await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      const grid = page.getByTestId("grid");
      const g = (await grid.boundingBox())!;
      const at = { x: g.x + Math.min(g.width - 40, 200), y: g.y + g.height * 0.7 };
      for (const dy of [-2500, -2500]) {
        await page.evaluate(() => window.__touchHud?.reset());
        const top0 = await grid.evaluate((el) => el.scrollTop);
        await cdp.send("Input.synthesizeScrollGesture", { x: at.x, y: at.y, yDistance: dy, speed: 6000, gestureSourceType: "touch", preventFling: false });
        let last = -1;
        for (let i = 0; i < 40; i += 1) {
          await page.waitForTimeout(200);
          const t = await grid.evaluate((el) => el.scrollTop);
          if (t === last) break;
          last = t;
        }
        const hud = await page.evaluate(() => ({ ...window.__touchHud! }));
        results.push({ variant, cpu, kind: "fling", frames: hud.frames, fps: hud.fps, p95: hud.p95, worst: hud.worst, over20: hud.over20, blank: hud.gaps, scrolled: Math.round(Math.abs(last - top0)) });
      }
      if (variant === "c") {
        // Hold on a cell, drag to the bottom edge, rest there 2 s while the grid auto-scrolls.
        const top0 = await grid.evaluate((el) => el.scrollTop);
        const from = { x: at.x, y: g.y + g.height * 0.4 };
        const edge = { x: at.x, y: g.y + g.height - 8 };
        const send = (type: string, p?: { x: number; y: number }) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ ...p, id: 0 }] : [] } as never);
        await send("touchStart", from);
        await page.waitForTimeout(260);
        await rec();
        for (let i = 1; i <= 10; i += 1) {
          await send("touchMove", { x: from.x, y: from.y + ((edge.y - from.y) * i) / 10 });
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(2000);
        const r = await stop();
        await send("touchEnd");
        const scrolled = Math.round((await grid.evaluate((el) => el.scrollTop)) - top0);
        results.push({ variant, cpu, kind: "hold-drag to edge", ...r, blank: 0, scrolled });
        expect(await page.getByTestId("namebox").textContent()).toMatch(/:/);
      }
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await cdp.detach();
    }
  }
  console.table(results);
  writeFileSync("docs/spike-7-touch/perf-c-results.json", JSON.stringify({ at: new Date().toISOString(), device: "Pixel 7 emulation, headless Chromium", results }, null, 2));
});
