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
  "account-reads-shared",
  "auth-password-change-signs-out",
  "background-sync-shared-pace",
  "calendar-delete-mid-round",
  "calendar-far-week-event",
  "calendar-invitations-push",
  "calendar-late-first-load",
  "calendar-list-autosave-reload",
  "calendar-many-events-window",
  "calendar-offline-week-event",
  "calendar-push",
  "calendar-shared-caches",
  "calendar-team-availability-offline",
  "calendar-visible-refresh",
  "contacts-detail-pass",
  "contacts-first-download",
  "contacts-first-open-count",
  "contacts-import-retry",
  "contacts-list-windowed",
  "contacts-offline-read-only",
  "contacts-open-draft-merge",
  "contacts-photo-pass",
  "contacts-push",
  "docs-collab-access-revoked",
  "docs-collab-doorbell",
  "docs-collab-external-write",
  "docs-collab-push-heartbeat",
  "docs-collab-racing-open",
  "docs-collab-solo-read",
  "docs-collab-suggest-save",
  "docs-comments-expired-state",
  "docs-comments-open-no-write",
  "docs-comments-push",
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
  "drive-first-sync-concurrent-write",
  "drive-folder-download",
  "drive-guest-large-download",
  "drive-guest-upload",
  "drive-inbound-many-files",
  "drive-inbound-swap",
  "drive-list-windowed",
  "drive-offline-home",
  "drive-offline-indicator",
  "drive-selection-download",
  "drive-upload-batch-dialog",
  "drive-upload-errors",
  "drive-upload-folder",
  "drive-upload-queue",
  "drive-upload-recovery",
  "inbound-sync-one-tab",
  "inbound-sync-tasks-drive",
  "meet-adhoc-two-users",
  "meet-audio-only-camera",
  "meet-call-doorbell",
  "meet-chat-push",
  "meet-chat-windowed",
  "meet-guest-chat",
  "meet-guest-video-mirror",
  "meet-mesh-channel-roster",
  "meet-opus-dtx",
  "meet-push-heartbeat",
  "meet-video-mirror",
  "mesh-check-now",
  "notes-collab-access-lost",
  "notes-collab-missed-tail",
  "notes-collab-planted-state",
  "notes-collab-steady-typing",
  "notes-create-lost-response",
  "notes-leave-within-save-delay",
  "notes-list-windowed",
  "notes-markdown-import",
  "notes-new-before-notebooks-load",
  "notes-new-tab-unsaved-text",
  "notes-offline-sync",
  "notes-push-network-loss",
  "notes-push-open-note",
  "notes-relist-many-notes",
  "notes-save-in-flight",
  "notes-sharee-star",
  "notes-undo-two-users",
  "notifications-hidden-call",
  "notifications-inbox-poll",
  "notifications-inbox-push",
  "notifications-read-batch",
  "notifications-toast",
  "presence-offline-start",
  "presence-team-rooms",
  "projects-filter-two-apps",
  "push-mesh-interval",
  "queued-write-reload",
  "rtc-idle-poll",
  "settings-calendar-availability",
  "settings-calendar-public-link",
  "settings-dialog-stays-open",
  "settings-offline-clear-cache",
  "sync-notice-bar",
  "tasks-assignees",
  "tasks-create-lost-response",
  "tasks-ics-import",
  "tasks-inbound-sync",
  "tasks-list-pages",
  "tasks-list-windowed",
  "tasks-live-text",
  "tasks-push",
  "tasks-thread-live",
  "two-factor",
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

/**
 * Production-build PWA tier: `vite build` plus `vite preview`, where the
 * service worker precaches every chunk, lazy app chunks included (#1628).
 * `playwright.pwa.config.mjs` runs it. Not part of the Storybook or live tier.
 */
export const pwaTierSpecPattern = /pwa-offline-reload\.spec\.ts/;

/**
 * Traffic budget measurement (#2292): several minutes per scenario against the
 * live stack. `playwright.traffic.config.mjs` runs it. Not part of the
 * Storybook or live tier.
 */
export const trafficTierSpecPattern = /traffic-budget\.spec\.ts/;
