import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

/** Keep “starts in 5 minutes” from going stale; cheap enough for sidebar + header. */
export const MEET_NOW_TICK_MS = 30_000;

export function useMeetNowClock(intervalMs = MEET_NOW_TICK_MS): Temporal.Instant {
  const [now, setNow] = useState(() => Temporal.Now.instant());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Temporal.Now.instant()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
