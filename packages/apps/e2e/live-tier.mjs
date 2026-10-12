/**
 * Playwright specs that drive the live app and API.
 * `playwright.config.mjs` ignores these. `playwright.live.config.mjs` runs the
 * live tier. `playwright.chaos.config.mjs` runs the real-time chaos suite.
 * `playwright.relay.config.mjs` runs the local coturn relay tier.
 */
export const liveTierSpecPattern =
  /(?:notes-offline-sync|docs-offline-sync|docs-home-browse|docs-collab-solo-read|calendar-offline-week-event|meet-adhoc-two-users|meet-guest-chat)\.spec\.ts/;

/** Real-time chaos suite (#1091). Parallel, and not part of the Storybook tier. */
export const chaosTierSpecPattern = /rtc-chaos\.spec\.ts/;

/** Local coturn relay tier. One worker, and not part of pull-request CI. */
export const relayTierSpecPattern = /rtc-relay\.spec\.ts/;
