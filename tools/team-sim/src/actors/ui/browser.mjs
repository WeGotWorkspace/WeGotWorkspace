import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { personaPassword } from "../../instance/config.mjs";

/** Client route path → screen template, for coverage. Order matters: specific first. */
export const SCREENS = [
  ["/login", /^\/login\/?$/],
  ["/", /^\/$/],
  ["/meet/channels/:id", /^\/meet\/channels\/[^/]+/],
  ["/meet/dms/:peer", /^\/meet\/dms\/[^/]+/],
  ["/meet/meetings/:code", /^\/meet\/meetings\/[^/]+/],
  ["/meet", /^\/meet\/?$/],
  ["/notes/all/:id", /^\/notes\/all\/[^/]+/],
  ["/notes", /^\/notes(\/all)?\/?$/],
  ["/tasks/lists/:id", /^\/tasks\/lists\/[^/]+/],
  ["/tasks", /^\/tasks\/?$/],
  ["/docs?file", /^\/docs\/?$/],
  ["/drive", /^\/drive\/?$/],
  ["/calendar/week/:date", /^\/calendar\/week\/[^/]+/],
  ["/calendar", /^\/calendar\/?$/],
  ["/contacts/all/:id", /^\/contacts\/all\/[^/]+/],
  ["/contacts/all", /^\/contacts(\/all)?\/?$/],
  ["/settings", /^\/settings/],
];
export const screenOf = (pathname) => SCREENS.find(([, re]) => re.test(pathname))?.[0] ?? null;

/**
 * One persona's browser: its own context against the instance origin, logged
 * in through the login page. Console errors, page errors, API responses and
 * visited routes are captured; each action runs under a trace that is kept
 * only when the action fails.
 */
export async function openPersonaBrowser({ browser, persona, origin, runDir, requestLog, events, screens, interactions = null }) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1400, height: 900 }, permissions: ["camera", "microphone"], locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
  let action = null;
  const attach = (page) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") events.push({ type: "console", level: "error", persona, action, text: msg.text(), route: safePath(page.url()) });
    });
    page.on("pageerror", (err) => events.push({ type: "pageerror", persona, action, text: `${err.name}: ${err.message}`, route: safePath(page.url()) }));
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const s = screenOf(safePath(frame.url()));
      if (s) screens.add(s);
    });
    // Timing is complete only once the body has arrived, so log on requestfinished.
    page.on("requestfinished", async (req) => {
      const url = new URL(req.url());
      if (url.origin !== origin || !url.pathname.startsWith("/api/v1/")) return;
      const at = action;
      const res = await req.response().catch(() => null);
      if (!res) return;
      const t = req.timing();
      requestLog.add({ persona, layer: "ui", method: req.method(), path: url.pathname, status: res.status(), ms: t.responseEnd >= 0 ? Math.round(t.responseEnd) : null, action: at });
    });
    page.on("requestfailed", (req) => {
      const url = new URL(req.url());
      if (url.origin !== origin || !url.pathname.startsWith("/api/v1/")) return;
      const why = req.failure()?.errorText ?? "failed";
      if (/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|NS_BINDING_ABORTED/.test(why)) return; // navigation and offline windows
      requestLog.add({ persona, layer: "ui", method: req.method(), path: url.pathname, status: 0, ms: 0, action, error: why });
    });
  };
  context.on("page", attach);
  await context.addInitScript(countInput);
  const page = await context.newPage();
  let current = null; // { waits, screens } of the action being traced

  async function login() {
    await page.goto("/login");
    await page.locator("#username").fill(persona);
    await page.locator("#password").fill(personaPassword(persona));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  }

  /** Opens a screen and times it until `ready()` resolves: the screen's time to interactive. */
  async function open(path, ready) {
    const t = performance.now();
    await page.goto(path);
    await ready();
    current?.screens.push({ screen: screenOf(safePath(page.url())) ?? path.split("?")[0], ms: Math.round(performance.now() - t) });
  }

  /** Times a wait the persona would sit through (a save, a sync, a message showing up). */
  async function wait(label, fn) {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      current?.waits.push({ label, ms: Math.round(performance.now() - t) });
    }
  }

  /** Runs `fn` under a trace; keeps the trace zip only on failure. Records input counts, waits, screens and a screenshot. */
  async function traced(n, fn) {
    action = n;
    current = { waits: [], screens: [] };
    const t = performance.now();
    await page.evaluate(() => sessionStorage.removeItem("__simInput")).catch(() => {});
    await context.tracing.start({ screenshots: true, snapshots: true, title: `#${n} ${persona}` });
    let failed = false;
    try {
      const result = await fn();
      await context.tracing.stop();
      return result;
    } catch (error) {
      failed = true;
      const dir = join(runDir, "traces");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${String(n).padStart(3, "0")}-${persona}.zip`);
      await context.tracing.stop({ path }).catch(() => {});
      error.trace = path;
      throw error;
    } finally {
      const input = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__simInput") || "null")).catch(() => null);
      const shot = join(runDir, "shots", `${String(n).padStart(3, "0")}-${persona}.jpg`);
      mkdirSync(join(runDir, "shots"), { recursive: true });
      const shotOk = await page.screenshot({ path: shot, type: "jpeg", quality: 45, scale: "css" }).then(() => true, () => false);
      interactions?.add({ n, persona, ms: Math.round(performance.now() - t), failed, clicks: input?.clicks ?? 0, keys: input?.keys ?? 0, waits: current.waits, screens: current.screens, shot: shotOk ? shot : null });
      current = null;
      action = null;
    }
  }

  return { persona, context, page, login, traced, open, wait, close: () => context.close() };
}

/**
 * Counts trusted (real input) clicks and keystrokes per tab in sessionStorage,
 * so the count survives in-tab navigations and reloads within one action.
 * Text inserted at once (paste-like) counts one key per character.
 */
function countInput() {
  const bump = (field, by = 1) => {
    try {
      const v = JSON.parse(sessionStorage.getItem("__simInput") || '{"clicks":0,"keys":0}');
      v[field] += by;
      sessionStorage.setItem("__simInput", JSON.stringify(v));
    } catch {
      // Storage can be unavailable on about:blank.
    }
  };
  addEventListener("pointerdown", (e) => e.isTrusted && bump("clicks"), true);
  addEventListener("keydown", (e) => e.isTrusted && bump("keys"), true);
  addEventListener("beforeinput", (e) => e.isTrusted && e.inputType === "insertText" && e.data && bump("keys", e.data.length), true);
}

const safePath = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
