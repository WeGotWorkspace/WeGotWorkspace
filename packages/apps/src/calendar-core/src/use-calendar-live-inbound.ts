import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import { useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { usePushBackupPoll } from "@/lib/live/use-push-backup-poll";
import { useSharedInboundSync } from "@/lib/api/wgw/use-shared-inbound-sync";
import type { JmapEventsAdapter } from "@/lib/jmap-client";

const PUSH_TYPES = ["CalendarEvent", "Calendar"] as const;
const NO_TYPES: readonly string[] = [];

/**
 * Live inbound Calendar sync (#1664): a push for `CalendarEvent` or `Calendar`
 * runs one `/changes` round when the pushed state differs from the adapter's
 * own. The poll backs it up: every 10 s, only while push is
 * not healthy. One tab per browser does this; in the others `onSharedRound`
 * re-reads the cache it writes (#2252). `adapter` is null until it has loaded
 * its first states.
 */
export function useCalendarLiveInbound(
  adapter: JmapEventsAdapter | null,
  username: string | null | undefined,
  onSharedRound: () => void,
): void {
  useSharedInboundSync(adapter, "calendar", username, onSharedRound);

  usePushBackupPoll(adapter, CALENDAR_BACKGROUND_POLL_MS);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : false,
  );
}
