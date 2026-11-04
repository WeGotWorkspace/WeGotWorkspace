/**
 * Shared poll interval. Inbound JMAP (`use-calendar-live-inbound`) owns the
 * event `/changes` timer; invitations keep their own loop. Hybrid
 * `use-calendar-api` is on-demand only — no `setInterval`.
 */
export const CALENDAR_BACKGROUND_POLL_MS = 10_000;
/** While push is connected the event `/changes` poll only backs it up (#1664). */
export const CALENDAR_PUSH_POLL_MS = 60_000;
