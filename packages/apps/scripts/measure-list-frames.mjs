#!/usr/bin/env node
/**
 * One place to measure list performance (#1641 step d).
 *
 * Drives a real app build in headless Chromium and records every long animation
 * frame (LoAF, > 50 ms) from the first interaction of a scenario until 2.5 s after
 * its last one. Prints long frames / worst ms / total ms, and the page's DOM node
 * count and mounted list rows, per run.
 *
 * Usage (against a production build: `vite build && vite preview`, live API):
 *   node scripts/measure-list-frames.mjs --app notes --base-url http://127.0.0.1:4461 \
 *     --api-url http://127.0.0.1:9461 [--scenario all|open|scroll|keys|type] [--runs 3] [--cpu 4]
 *
 * Each run uses a fresh browser context (no cache, no IndexedDB): a cold first visit.
 * Scenarios find rows by position on screen, never by DOM index, so the numbers
 * compare a list that keeps every row in the DOM with one that windows them.
 */
import { chromium } from "@playwright/test";
import { parseArgs } from "node:util";

const LONG_FRAME_MS = 50;
const TAIL_MS = 2500;
const KEY_DELAY_MS = 110;
const ROW_SELECTOR = "[data-list-item-id]";

const { values } = parseArgs({
  options: {
    app: { type: "string", default: "notes" },
    scenario: { type: "string", default: "all" },
    runs: { type: "string", default: "3" },
    cpu: { type: "string", default: "1" },
    "base-url": { type: "string", default: "http://127.0.0.1:4173" },
    "api-url": { type: "string", default: "http://127.0.0.1:9080" },
    username: { type: "string", default: process.env.WGW_E2E_USERNAME ?? "admin" },
    password: { type: "string", default: process.env.WGW_E2E_PASSWORD ?? "storybook-dev" },
    json: { type: "boolean", default: false },
  },
});

/** Starts the LoAF observer before any app code runs. */
function installFrameObserver() {
  window.__wgwLongFrames = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__wgwLongFrames.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // No LoAF in this browser: the report says so (frames stay empty).
  }
}

async function tokenSession(apiUrl, username, password) {
  const response = await fetch(`${apiUrl}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Login failed (${response.status}): ${await response.text()}`);
  const tokens = await response.json();
  return tokens.access_token;
}

async function now(page) {
  return page.evaluate(() => performance.now());
}

async function framesBetween(page, from, to) {
  return page.evaluate(
    ({ from, to, min }) =>
      window.__wgwLongFrames.filter(
        (frame) =>
          frame.duration > min && frame.start + frame.duration >= from && frame.start <= to,
      ),
    { from, to, min: LONG_FRAME_MS },
  );
}

async function pageShape(page) {
  return page.evaluate((rowSelector) => {
    return {
      nodes: document.getElementsByTagName("*").length,
      rows: document.querySelectorAll(rowSelector).length,
    };
  }, ROW_SELECTOR);
}

/** The scrolling element around the app's list rows. */
async function scrollList(page, top) {
  await page.evaluate(
    ({ rowSelector, top }) => {
      const row = document.querySelector(rowSelector);
      let node = row?.parentElement ?? null;
      while (
        node &&
        !(
          node.scrollHeight > node.clientHeight + 1 &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)
        )
      ) {
        node = node.parentElement;
      }
      if (node) node.scrollTop = top;
    },
    { rowSelector: ROW_SELECTOR, top },
  );
}

/** Clicks the list row shown in the middle of the list's scroller. */
async function clickRowInMiddle(page) {
  const point = await page.evaluate((rowSelector) => {
    const row = document.querySelector(rowSelector);
    let node = row?.parentElement ?? null;
    while (
      node &&
      !(
        node.scrollHeight > node.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(node).overflowY)
      )
    ) {
      node = node.parentElement;
    }
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, ROW_SELECTOR);
  if (!point) throw new Error("No list scroller found");
  await page.mouse.click(point.x, point.y);
}

const APPS = {
  notes: {
    path: "/notes",
    async ready(page) {
      await page.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
      await page.getByLabel("Loading notes…").waitFor({ state: "detached", timeout: 60_000 });
      await page.locator(ROW_SELECTOR).first().waitFor({ timeout: 60_000 });
    },
    scenarios: {
      /** Cold open: from navigation until the list has painted and settled. */
      async open(page) {
        await APPS.notes.ready(page);
        return { start: 0, interactions: 1 };
      },
      /** Scroll the whole list in 20 steps (a wheel flick through ~1000 rows). */
      async scroll(page) {
        await APPS.notes.ready(page);
        await page.waitForTimeout(1500);
        const start = await now(page);
        const total = await page.evaluate((rowSelector) => {
          const row = document.querySelector(rowSelector);
          let node = row?.parentElement ?? null;
          while (node && !(node.scrollHeight > node.clientHeight + 1)) node = node.parentElement;
          return node?.scrollHeight ?? 0;
        }, ROW_SELECTOR);
        for (let step = 1; step <= 20; step += 1) {
          await scrollList(page, (total * step) / 20);
          await page.waitForTimeout(100);
        }
        return { start, interactions: 20 };
      },
      /** Select a row, then ArrowDown 30 times at typing speed. */
      async keys(page) {
        await APPS.notes.ready(page);
        await page.waitForTimeout(1500);
        await page.locator(ROW_SELECTOR).first().click();
        await page.waitForTimeout(1000);
        const start = await now(page);
        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press("ArrowDown");
          await page.waitForTimeout(KEY_DELAY_MS);
        }
        return { start, interactions: 30 };
      },
      /** Open a note about 40 rows down and type 40 characters in its body (#1714). */
      async type(page) {
        await APPS.notes.ready(page);
        await page.waitForTimeout(1500);
        await scrollList(page, 4000);
        await page.waitForTimeout(500);
        await clickRowInMiddle(page);
        const editor = page.locator(".ProseMirror");
        await editor.waitFor({ timeout: 15_000 });
        await editor.click();
        await page.keyboard.press("End");
        await page.waitForTimeout(1500);
        const start = await now(page);
        await page.keyboard.type("Typing in a long list stays smooth ok. ", {
          delay: KEY_DELAY_MS,
        });
        return { start, interactions: 40 };
      },
    },
  },
};

async function runOnce(browser, app, scenarioName, accessToken) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(installFrameObserver);
  await context.addInitScript((token) => {
    if (!localStorage.getItem("wgw.api.access_token")) {
      localStorage.setItem("wgw.api.access_token", token);
      localStorage.setItem("wgw.api.session_kind", "member");
    }
  }, accessToken);
  const page = await context.newPage();
  const cpu = Number(values.cpu);
  if (cpu > 1) {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  }
  await page.goto(new URL(app.path, values["base-url"]).toString());
  const { start } = await app.scenarios[scenarioName](page, {});
  const end = (await now(page)) + TAIL_MS;
  await page.waitForTimeout(TAIL_MS);
  const frames = await framesBetween(page, start, end);
  const shape = await pageShape(page);
  await context.close();
  const durations = frames.map((frame) => Math.round(frame.duration));
  return {
    longFrames: durations.length,
    worstMs: durations.length ? Math.max(...durations) : 0,
    totalMs: durations.reduce((sum, d) => sum + d, 0),
    ...shape,
  };
}

async function main() {
  const app = APPS[values.app];
  if (!app) throw new Error(`Unknown app "${values.app}". Known: ${Object.keys(APPS).join(", ")}`);
  const scenarios =
    values.scenario === "all" ? Object.keys(app.scenarios) : values.scenario.split(",");
  const accessToken = await tokenSession(values["api-url"], values.username, values.password);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const scenario of scenarios) {
      if (!app.scenarios[scenario]) throw new Error(`Unknown scenario "${scenario}"`);
      for (let run = 1; run <= Number(values.runs); run += 1) {
        const result = await runOnce(browser, app, scenario, accessToken);
        results.push({ app: values.app, scenario, run, cpu: Number(values.cpu), ...result });
        if (!values.json) {
          console.log(
            `${values.app} ${scenario} run ${run} (cpu ${values.cpu}x): ` +
              `${result.longFrames} / ${result.worstMs} / ${result.totalMs} ms ` +
              `(long frames / worst / total), ${result.nodes} nodes, ${result.rows} rows mounted`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (values.json) console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
