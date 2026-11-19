import { useEffect } from "react";
import {
  CALENDAR_BACKGROUND_POLL_MS,
  CALENDAR_PUSH_POLL_MS,
} from "@/calendar-core/src/calendar-refresh";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { useSharedInboundSync } from "@/lib/api/wgw/use-shared-inbound-sync";
import type { JmapEventsAdapter } from "@/lib/jmap-client";

const PUSH_TYPES = ["CalendarEvent", "Calendar"] as const;
const NO_TYPES: readonly string[] = [];

/**
 * Live inbound Calendar sync (#1664): a push for `CalendarEvent` or `Calendar`
 * runs one `/changes` round when the pushed state differs from the adapter's
 * own. The poll backs it up: every 10 s, or every 60 s while push is
 * connected. One tab per browser does this; in the others `onSharedRound`
 * re-reads the cache it writes (#2252). `adapter` is null until it has loaded
 * its first states.
 */
export function useCalendarLiveInbound(
  adapter: JmapEventsAdapter | null,
  username: string | null | undefined,
  onSharedRound: () => void,
): void {
  useSharedInboundSync(adapter, "calendar", username, onSharedRound);

  const pushConnected = useJmapPushConnected();
  useEffect(() => {
    if (!adapter) return;
    adapter.startPolling(pushConnected ? CALENDAR_PUSH_POLL_MS : CALENDAR_BACKGROUND_POLL_MS);
    return () => adapter.stopPolling();
  }, [adapter, pushConnected]);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : false,
  );
}
