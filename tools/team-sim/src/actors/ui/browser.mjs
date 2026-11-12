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
export async function openPersonaBrowser({ browser, persona, origin, runDir, requestLog, events, screens }) {
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
  const page = await context.newPage();

  async function login() {
    await page.goto("/login");
    await page.locator("#username").fill(persona);
    await page.locator("#password").fill(personaPassword(persona));
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  }

  /** Runs `fn` under a trace; keeps the trace zip only on failure. */
  async function traced(n, fn) {
    action = n;
    await context.tracing.start({ screenshots: true, snapshots: true, title: `#${n} ${persona}` });
    try {
      const result = await fn();
      await context.tracing.stop();
      return result;
    } catch (error) {
      const dir = join(runDir, "traces");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${String(n).padStart(3, "0")}-${persona}.zip`);
      await context.tracing.stop({ path }).catch(() => {});
      error.trace = path;
      throw error;
    } finally {
      action = null;
    }
  }

  return { persona, context, page, login, traced, close: () => context.close() };
}

const safePath = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
