import { executeApi } from "../api/index.mjs";
import { openPersonaBrowser } from "./browser.mjs";
import { uiActions } from "./actions.mjs";

/**
 * Browser layer for the night's UI personas. One Chromium, one context per
 * persona (logged in through the login page on first use), fake camera and
 * microphone for Meet. Kinds without a browser flow run through the API and
 * say so in the outcome note.
 */
export async function createUiLayer({ origin, runDir, requestLog, headless = true }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const events = [];
  const screens = new Set();
  const personas = new Map();

  async function forPersona(persona) {
    if (!personas.has(persona)) {
      const b = await openPersonaBrowser({ browser, persona, origin, runDir, requestLog, events, screens });
      await b.login();
      personas.set(persona, b);
    }
    return personas.get(persona);
  }

  async function extraBrowser(persona) {
    const b = await openPersonaBrowser({ browser, persona, origin, runDir, requestLog, events, screens });
    await b.login();
    return b;
  }

  async function guestBrowser() {
    return openPersonaBrowser({ browser, persona: "guest", origin, runDir, requestLog, events, screens });
  }

  async function execute(action, ctx) {
    const fn = uiActions[action.kind];
    if (!fn) {
      const r = await executeApi({ ...action, layer: "api" }, ctx);
      return { ...r, note: [r?.note, "no browser flow; ran through the API"].filter(Boolean).join("; ") };
    }
    const b = await forPersona(action.persona);
    ctx.client(action.persona).setAction(action.n);
    return b.traced(action.n, () => fn(b, action, { ...ctx, extraBrowser, guestBrowser }));
  }

  async function close() {
    for (const b of personas.values()) await b.close().catch(() => {});
    await browser.close();
  }

  return { execute, close, events, screens };
}
