import { rmSync } from "node:fs";
import { join } from "node:path";
import { executeApi } from "../api/index.mjs";
import { HarnessDoubt } from "../doubt.mjs";
import { openPersonaBrowser } from "./browser.mjs";
import { uiActions } from "./actions.mjs";
import { uiGoogle } from "./google.mjs";

const flows = { ...uiActions, ...uiGoogle };

/** Which engine and device profile each browser in the roster stands for. */
export const BROWSERS = {
  chrome: { engine: "chromium", emulate: null, device: "desk" },
  safari: { engine: "webkit", emulate: null, device: "desk" },
  iphone: { engine: "webkit", emulate: "iPhone 15", device: "phone" },
  android: { engine: "chromium", emulate: "Pixel 7", device: "phone" },
};
/** Meet needs a fake camera and microphone, which only Chromium has headless: those run in Chromium on every desk. */
const CAMERA_KINDS = new Set(["meet.call"]);

/**
 * Browser layer for the night's UI personas. Chromium (Chrome on the Mac,
 * Chrome on Android) and WebKit (Safari on the Mac, Safari on the iPhone),
 * started when first needed; one context per persona and browser, logged in
 * through the login page on first use. Kinds without a browser flow run
 * through the API and say so in the outcome note.
 */
/** Playwright's words for a page or browser process that died under it. */
export const CRASHED = /Page crashed|Target crashed|Browser has been closed|Target page, context or browser has been closed|browser has disconnected/i;

export async function createUiLayer({ origin, runDir, requestLog, interactions = null, headless = true }) {
  const playwright = await import("playwright");
  const engines = new Map();
  const events = [];
  const screens = new Set();
  const personas = new Map();

  async function engine(name) {
    if (!engines.has(name)) {
      const args = name === "chromium" ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] : [];
      engines.set(name, await playwright[name].launch({ headless, args }));
    }
    return engines.get(name);
  }

  // WebKit's own contexts are like a private window, where IndexedDB will not keep files (Drive's upload
  // queue then does nothing). Safari is not used that way, so each WebKit persona gets a profile on disk.
  let profiles = 0;
  const profileRoot = join(runDir, "profiles");
  const persistent = (name) => (options) => playwright[name].launchPersistentContext(join(profileRoot, String((profiles += 1))), { headless, ...options });

  async function open(persona, browserName, { login = true, track = true } = {}) {
    const spec = BROWSERS[browserName] ?? BROWSERS.chrome;
    const b = await openPersonaBrowser({
      ...(spec.engine === "webkit" ? { makeContext: persistent("webkit") } : { browser: await engine(spec.engine) }),
      persona,
      origin,
      runDir,
      requestLog,
      events,
      screens,
      interactions: track ? interactions : null,
      emulate: spec.emulate ? playwright.devices[spec.emulate] : null,
      media: spec.engine === "chromium",
      device: spec.device,
      browserName: browserName in BROWSERS ? browserName : "chrome",
    });
    if (login) await b.login();
    return b;
  }

  async function forPersona(persona, browserName) {
    const key = `${persona}/${browserName}`;
    if (!personas.has(key)) personas.set(key, await open(persona, browserName));
    return personas.get(key);
  }

  /** A colleague in the same flow (co-writer, author accepting a suggestion) on their own desk browser. */
  const extraBrowser = (persona) => open(persona, world?.persona(persona)?.devices?.browser ?? "chrome", { track: false });
  const guestBrowser = () => open("guest", "chrome", { login: false, track: false });
  let world = null;

  async function execute(action, ctx) {
    world = ctx.world;
    const fn = flows[action.kind];
    if (!fn) {
      const r = await executeApi({ ...action, layer: "api" }, ctx);
      return { ...r, note: [r?.note, "no browser flow; ran through the API"].filter(Boolean).join("; ") };
    }
    const wanted = action.browser ?? "chrome";
    const browserName = CAMERA_KINDS.has(action.kind) && BROWSERS[wanted]?.engine !== "chromium" ? "chrome" : wanted;
    const b = await forPersona(action.persona, browserName);
    ctx.client(action.persona).setAction(action.n);
    let r;
    try {
      r = await b.traced(action.n, () => fn(b, action, { ...ctx, extraBrowser, guestBrowser }));
    } catch (error) {
      if (!CRASHED.test(error.message)) throw error;
      // The page or browser process died on the test machine (seen with WebKit under memory pressure). A
      // person would not see the app do this, so it counts as a harness doubt, and the next action gets a
      // fresh browser instead of the dead page.
      personas.delete(`${action.persona}/${browserName}`);
      await b.close().catch(() => {});
      const doubt = new HarnessDoubt(`the test machine's ${browserName} browser crashed: ${error.message.split("\n")[0]}`);
      doubt.trace = error.trace;
      throw doubt;
    }
    const where = `${BROWSERS[browserName].device === "phone" ? `${browserName === "iphone" ? "iPhone" : "Android"} phone` : browserName === "safari" ? "Safari" : "Chrome"}${browserName !== wanted ? ` (Meet needs Chromium's fake camera, not ${wanted})` : ""}`;
    return { ...r, note: [r?.note, browserName !== "chrome" || wanted !== "chrome" ? where : null].filter(Boolean).join("; ") };
  }

  async function close() {
    for (const b of personas.values()) await b.close().catch(() => {});
    for (const e of engines.values()) await e.close().catch(() => {});
    rmSync(profileRoot, { recursive: true, force: true });
  }

  return { execute, close, events, screens };
}
