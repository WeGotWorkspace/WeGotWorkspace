/**
 * Playwright specs that drive the live app and API.
 * `playwright.config.mjs` ignores these. `playwright.live.config.mjs` runs the
 * live tier. `playwright.chaos.config.mjs` runs the real-time chaos suite.
 */
export const liveTierSpecPattern =
  /(?:notes-offline-sync|docs-offline-sync|docs-home-browse|calendar-offline-week-event|meet-adhoc-two-users|meet-guest-chat)\.spec\.ts/;

/** Real-time chaos suite (#1091). Parallel, and not part of the Storybook tier. */
export const chaosTierSpecPattern = /rtc-chaos\.spec\.ts/;
