/**
 * Shared poll interval. Inbound JMAP (`use-calendar-surface` adapter) owns the
 * event `/changes` timer; invitations keep their own loop. Hybrid
 * `use-calendar-api` is on-demand only — no `setInterval`.
 */
export const CALENDAR_BACKGROUND_POLL_MS = 10_000;
