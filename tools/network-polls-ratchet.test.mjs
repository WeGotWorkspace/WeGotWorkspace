import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Ratchet for client polls (#2298). Every `*_POLL_MS` / `*_POLL_INTERVAL_MS`
 * constant and every `setInterval` in `packages/apps/src` needs an entry here
 * with a reason. A new poll without an entry fails, and so does an entry that no
 * longer matches anything, so the list cannot go stale. Live updates use the
 * doorbell pattern (docs/architecture/jmap-push.md#doorbell-pattern): a backup
 * poll runs only while push is down. Entries marked "no network" are timers
 * that send no request; they are listed so the scan stays simple.
 *
 * It reads source text, so it lives in tools/ (run by `ci:quality:apps`), not in
 * the app's vitest suite, which must not assert on source text.
 */
const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "apps",
  "src",
);

const POLL_CONSTANT = /\bconst\s+((?:[A-Z0-9]+_)*POLL(?:_INTERVAL)?_MS)\b/g;
const SET_INTERVAL = /\bsetInterval\s*\(/;

/** `file::constant` or `file::setInterval` → why the poll exists. */
const ALLOWED = {
  // Backup polls for push-driven lists: they slow down or stop while push is up.
  "docs-core/src/collab/use-docs-threads-source.ts::DOCS_THREADS_POLL_MS":
    "Docs threads backup pull, runs only while push is down (use-push-pulled-list)",
  "lib/live/use-push-backup-poll.ts::setInterval":
    "the one backup poll of every inbound sync, armed only while push is not healthy (#2296)",
  "lib/live/use-push-pulled-list.ts::setInterval":
    "the shared backup pull of the doorbell pattern, armed only while push is down",
  "notes-core/src/use-notes-live-inbound.ts::NOTES_CHANGES_POLL_MS":
    "Notes /changes backup poll, only while push is not healthy",
  "notes-core/src/use-notes-api.ts::setInterval":
    "Notes list refresh at NOTES_CHANGES_POLL_MS for the on-screen list",
  "calendar-core/src/calendar-refresh.ts::CALENDAR_BACKGROUND_POLL_MS":
    "Calendar event poll while push is down",
  "calendar-core/src/calendar-refresh.ts::CALENDAR_PUSH_POLL_MS":
    "Calendar invitations safety poll while push is connected",
  "calendar-core/src/use-calendar-invitations.ts::setInterval":
    "silent invitation refresh at the Calendar background cadence",
  "calendar-core/src/use-team-availability.ts::setInterval":
    "team availability refresh while the panel is open",
  "lib/offline/contacts/use-contacts-live-inbound.ts::CONTACTS_CHANGES_POLL_MS":
    "Contacts /changes backup poll while push is down",
  "lib/offline/tasks/tasks-inbound-sync.ts::TASKS_INBOUND_POLL_MS":
    "Tasks inbound backup poll while push is down",
  "meet-core/src/use-meet-chat-live-inbound.ts::CHAT_CHANGES_POLL_MS":
    "Meet chat /changes backup poll while push is down",
  "notifications-core/src/notifications-provider.tsx::NOTIFICATIONS_INBOX_POLL_MS":
    "inbox poll while push is down",
  "notifications-core/src/notifications-provider.tsx::NOTIFICATIONS_INBOX_PUSH_POLL_MS":
    "inbox safety poll while push is connected",
  "notifications-core/src/notifications-provider.tsx::setInterval":
    "inbox poll timer at the cadence above",
  "lib/jmap-client/adapter/JmapInboundAdapter.ts::setInterval":
    "the inbound adapter's poll timer, driven by startPolling(ms) from each app",
  "admin-core/src/use-admin-update-poll.ts::UPDATE_PROGRESS_POLL_MS":
    "update status while an update runs; no push type exists for it",
  "admin-core/src/use-admin-update-poll.ts::UPDATE_IDLE_POLL_MS":
    "update status check on the admin page, once a minute",
  "meet-core/src/use-meet-channel-call-activity.ts::MEET_CALL_ACTIVITY_POLL_MS":
    "backup poll of who is in a channel call; runs only while push is down, `MeetCall` rings it otherwise (#2295)",
  "meet-core/src/use-meet-channel-call-activity.ts::setInterval":
    "call activity backup poll at MEET_CALL_ACTIVITY_POLL_MS, only while push is down",
  "meet-core/src/use-meet-room-state.ts::setInterval":
    "Meet room state refresh while a room is open",
  "meet-core/src/use-meet-invite-probe.ts::setInterval":
    "Meet invite probe while the invite page waits",
  "meet-core/src/use-meet-inbound-media-hints.ts::setInterval":
    "Meet media hints for the open call",
  // The room mailbox of a WebRTC peer: fast only while a peer is connecting.
  "lib/rtc/session/poll-cadence.ts::COLLAB_ALONE_POLL_INTERVAL_MS":
    "room mailbox cadence when alone in a Docs room",
  "lib/rtc/session/poll-cadence.ts::COLLAB_STABLE_POLL_INTERVAL_MS":
    "room mailbox cadence once peers are linked",
  "lib/rtc/session/poll-cadence.ts::MEET_IDLE_POLL_INTERVAL_MS":
    "room mailbox floor for idle Meet rooms",
  "lib/rtc/session/poll-cadence.ts::HIDDEN_IDLE_POLL_INTERVAL_MS":
    "room mailbox cadence for a hidden tab",
  "lib/rtc/session/poll-cadence.ts::DOORBELL_HEARTBEAT_POLL_INTERVAL_MS":
    "room mailbox heartbeat while the room doorbell covers changes",
  "presence-core/src/presence-rtc-session.ts::ACTIVE_STEADY_POLL_MS":
    "presence mailbox while a peer is dialing (the short fast poll)",
  "presence-core/src/presence-rtc-session.ts::ALONE_STEADY_POLL_MS":
    "presence mailbox cadence when alone",
  "presence-core/src/presence-rtc-session.ts::IDLE_STEADY_POLL_MS":
    "presence mailbox cadence with linked peers",
  "presence-core/src/presence-provider.tsx::setInterval":
    "presence boot recheck and team check timers",
  "text-editor-core/docs-collab/docs-collab-http-wire.ts::YJS_HTTP_POLL_MS":
    "Yjs HTTP fallback poll in fast mode (a peer is syncing)",
  "text-editor-core/docs-collab/docs-collab-http-wire.ts::YJS_HTTP_IDLE_POLL_MS":
    "Yjs HTTP fallback poll in idle mode",
  "text-editor-core/docs-collab/docs-collab-http-sync.ts::setInterval":
    "Yjs HTTP resync of due documents",
  "thread-ui/src/use-thread.ts::THREAD_POLL_MS":
    "open comment thread refresh in the thread UI",
  "thread-ui/src/use-thread.ts::setInterval":
    "thread refresh at THREAD_POLL_MS",
  "lib/offline/drive/upload/drive-upload-runner.ts::DRIVE_UPLOAD_SPACE_POLL_MS":
    "storage space probe while an upload is blocked on quota",
  "lib/offline/drive/upload/drive-upload-leave-warning.ts::setInterval":
    "last-tab check for the upload leave warning; no network",
  "lib/api/wgw/session-keeper.ts::setInterval": "session keep-alive ping",
  // Local timers that send no request.
  "presence-core/src/principal-tab-sync.ts::setInterval":
    "no network: cross-tab election ping",
  "text-editor-core/docs-collab/docs-collab-tab-sync.ts::setInterval":
    "no network: cross-tab election ping",
  "lib/cross-tab/cross-tab-lock.ts::CROSS_TAB_LOCK_POLL_MS":
    "no network: Web Lock fallback poll",
  "lib/cross-tab/cross-tab-lock.ts::setInterval":
    "no network: lock fallback timer",
  "lib/rtc/session/push-heartbeat-peers.ts::setInterval":
    "no network: rewrites this tab's push-heartbeat peers in localStorage every 20 s",
  "text-editor-core/src/text-editor-print.ts::PRINT_IMAGE_POLL_MS":
    "no network: waits for images before printing (setTimeout)",
  "hooks/use-failed-outbox-count.ts::setInterval":
    "no network: reads the local outbox",
  "notes-core/src/use-notes-pending-sync.ts::setInterval":
    "no network: reads the local outbox",
  "notes-core/src/use-notes-pending-sync.ts::POLL_INTERVAL_MS":
    "no network: reads the local outbox",
  "calendar-core/src/use-calendar-pending-sync.ts::setInterval":
    "no network: reads the local outbox",
  "contacts-core/src/use-contacts-pending-sync.ts::setInterval":
    "no network: reads the local outbox",
  "tasks-core/src/use-tasks-pending-sync.ts::setInterval":
    "no network: reads the local outbox",
  "calendar-core/src/use-calendar-pending-sync.ts::POLL_INTERVAL_MS":
    "no network: reads the local outbox",
  "contacts-core/src/use-contacts-pending-sync.ts::POLL_INTERVAL_MS":
    "no network: reads the local outbox",
  "hooks/use-failed-outbox-count.ts::POLL_INTERVAL_MS":
    "no network: reads the local outbox",
  "tasks-core/src/use-tasks-pending-sync.ts::POLL_INTERVAL_MS":
    "no network: reads the local outbox",
  "calendar-core/src/calendar-notice-bar.tsx::setInterval":
    "no network: redraws a time stamp",
  "lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.ts::setInterval":
    "no network: moves the now line",
  "meet-core/src/use-meet-now-clock.ts::setInterval": "no network: clock",
  "meet-core/src/use-meet-speech-levels.ts::setInterval":
    "no network: audio level sampling",
  "meet-core/src/use-peer-stream-presence.ts::setInterval":
    "no network: stream presence check",
  "meet-core/src/use-meet-workspace-shell.tsx::setInterval":
    "no network: animation",
  "meet-core/src/meet-call-broadcast.ts::setInterval":
    "no network: BroadcastChannel sweep",
  "meet-core/src/meet-call-mini-player.tsx::setInterval": "no network: clock",
  "meet-core/src/meet-stream-video.tsx::setInterval":
    "no network: video metrics",
};

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" ? [] : sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name))
      return [];
    return [path];
  });
}

/** @returns {string[]} */
function found() {
  const keys = new Set();
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    const text = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const match of text.matchAll(POLL_CONSTANT))
      keys.add(`${rel}::${match[1]}`);
    if (SET_INTERVAL.test(text)) keys.add(`${rel}::setInterval`);
  }
  return [...keys].sort();
}

const matches = found();

test("every client poll has a justification", () => {
  assert.deepEqual(
    matches.filter((key) => !(key in ALLOWED)),
    [],
    "Add the new poll to ALLOWED with a reason (see the Doorbell pattern in docs/architecture/jmap-push.md).",
  );
});

test("no allowlist entry outlives its poll", () => {
  assert.deepEqual(
    Object.keys(ALLOWED).filter((key) => !matches.includes(key)),
    [],
    "Remove entries whose poll is gone.",
  );
});

test("every entry has a reason", () => {
  for (const [key, why] of Object.entries(ALLOWED))
    assert.ok(why.trim() !== "", key);
});
