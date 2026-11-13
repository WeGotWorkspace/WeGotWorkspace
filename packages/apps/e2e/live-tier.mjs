/**
 * Playwright specs that drive the live app and API.
 * `playwright.config.mjs` ignores these. `playwright.live.config.mjs` runs the
 * live tier. `playwright.chaos.config.mjs` runs the real-time chaos suite.
 * `playwright.relay.config.mjs` runs the local coturn relay tier.
 *
 * `liveTierSpecs` lists the live tier: one spec name per line (no
 * `.spec.ts`), in alphabetical order, each with a trailing comma. To add a
 * live spec, add one line in its sorted place. Two pull requests that each
 * add a spec then merge without a conflict.
 * `tools/live-e2e-webserver.test.mjs` checks the order.
 */
export const liveTierSpecs = [
  "calendar-far-week-event",
  "calendar-list-autosave-reload",
  "calendar-offline-week-event",
  "calendar-push",
  "calendar-team-availability-offline",
  "contacts-first-download",
  "contacts-first-open-count",
  "contacts-offline-read-only",
  "contacts-open-draft-merge",
  "contacts-push",
  "docs-collab-access-revoked",
  "docs-collab-external-write",
  "docs-collab-racing-open",
  "docs-collab-solo-read",
  "docs-collab-suggest-save",
  "docs-comments-expired-state",
  "docs-comments-open-no-write",
  "docs-docx-save-as-markdown",
  "docs-download-word",
  "docs-home-browse",
  "docs-import-word-file",
  "docs-inbound-sync",
  "docs-offline-gaps",
  "docs-offline-sync",
  "docs-open-by-id",
  "docs-open-cached-row",
  "docs-page-break-two-tabs",
  "docs-print",
  "docs-suggestion-reaction-author",
  "drive-file-node-push",
  "drive-first-sync",
  "drive-folder-download",
  "drive-guest-large-download",
  "drive-guest-upload",
  "drive-inbound-many-files",
  "drive-offline-home",
  "drive-selection-download",
  "drive-upload-batch-dialog",
  "drive-upload-errors",
  "drive-upload-folder",
  "drive-upload-queue",
  "drive-upload-recovery",
  "meet-adhoc-two-users",
  "meet-audio-only-camera",
  "meet-chat-push",
  "meet-guest-chat",
  "meet-guest-video-mirror",
  "meet-mesh-channel-roster",
  "mesh-check-now",
  "notes-collab-access-lost",
  "notes-collab-missed-tail",
  "notes-collab-steady-typing",
  "notes-create-lost-response",
  "notes-leave-within-save-delay",
  "notes-markdown-import",
  "notes-new-before-notebooks-load",
  "notes-new-tab-unsaved-text",
  "notes-offline-sync",
  "notes-push-open-note",
  "notes-relist-many-notes",
  "notes-save-in-flight",
  "notes-sharee-star",
  "notes-undo-two-users",
  "notifications-inbox-push",
  "notifications-toast",
  "presence-offline-start",
  "presence-team-rooms",
  "push-mesh-interval",
  "queued-write-reload",
  "settings-calendar-availability",
  "sync-notice-bar",
  "tasks-ics-import",
  "tasks-inbound-sync",
  "tasks-push",
  "undo-offline",
];

export const liveTierSpecPattern = new RegExp(`(?:${liveTierSpecs.join("|")})\\.spec\\.ts`);

/**
 * Notes sync matrix: every action × tab setup × connectivity case (about 110
 * cases, about 90 minutes on one CI runner against Vite dev). Its own nightly
 * job in four shards, so the live tier stays short.
 */
export const notesSyncMatrixSpecPattern = /notes-sync-matrix\.spec\.ts/;

/**
 * Tasks sync matrix (#1565): every action × tab setup × connectivity case,
 * plus the inbound cases (changes token, full-list fallback, conflict check,
 * list deletes). Its own nightly job, like the Notes matrix.
 */
export const tasksSyncMatrixSpecPattern = /tasks-sync-matrix\.spec\.ts/;

/**
 * Docs sync matrix (#1563): every action × tab setup × connectivity case on a
 * Doc (create, rename, move, body edit, empty body, trash, restore, delete,
 * star, share), plus a case per fixed offline gap. Its own nightly job, like
 * the Notes matrix.
 */
export const docsSyncMatrixSpecPattern = /docs-sync-matrix\.spec\.ts/;

/**
 * Contacts sync matrix (#1565): the inbound cases (changes token on reload and
 * on reconnect, full-list fallback, queued-write conflict check). Its own
 * nightly job, like the Notes matrix.
 */
export const contactsSyncMatrixSpecPattern = /contacts-sync-matrix\.spec\.ts/;

/**
 * Calendar sync matrix (#1565): the open tab's inbound cases (changes through
 * CalendarEvent/changes, full-list fallback, queued-write conflict check). Its
 * own nightly job, like the Contacts matrix.
 */
export const calendarSyncMatrixSpecPattern = /calendar-sync-matrix\.spec\.ts/;

/**
 * Meet chat sync matrix (#1565): chat on the shared offline engine (cold
 * offline open, offline send and reload, second tab, a refused send, changes
 * through the channel token). Needs the production build for the offline
 * cases. Its own nightly job, like the Contacts matrix.
 */
export const meetChatSyncMatrixSpecPattern = /meet-chat-sync-matrix\.spec\.ts/;

/** Real-time chaos suite (#1091). Parallel, and not part of the Storybook tier. */
export const chaosTierSpecPattern = /rtc-chaos\.spec\.ts/;

/** Local coturn relay tier. One worker, and not part of pull-request CI. */
export const relayTierSpecPattern = /rtc-relay\.spec\.ts/;
