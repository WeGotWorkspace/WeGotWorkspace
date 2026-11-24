/**
 * Shared poll interval. Inbound JMAP (`use-calendar-live-inbound`) owns the
 * event `/changes` timer; invitations keep their own loop. Hybrid
 * `use-calendar-api` is on-demand only — no `setInterval`.
 */
export const CALENDAR_BACKGROUND_POLL_MS = 10_000;
/** While push is connected the invitations poll slows to this interval (#2287). */
export const CALENDAR_PUSH_POLL_MS = 60_000;
