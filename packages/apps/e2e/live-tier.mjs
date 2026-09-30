/**
 * Playwright specs that drive the live app and API.
 * `playwright.config.mjs` ignores these. `playwright.live.config.mjs` runs only these.
 */
export const liveTierSpecPattern =
  /(?:notes-offline-sync|docs-offline-sync|docs-home-browse|calendar-offline-week-event|meet-adhoc-two-users)\.spec\.ts/;
