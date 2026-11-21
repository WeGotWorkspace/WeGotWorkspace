import { useCallback, useEffect, useRef, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { wgwAwaitSessionRefreshForReconnect } from "@/lib/api/wgw/http";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { randomSpreadMs } from "@/lib/traffic/jitter";

/** Reconnect flushes spread over 0–4 s so tabs and browsers do not all send at once (#2288). */
export const RECONNECT_FLUSH_SPREAD_MS = 4000;

type UseOfflineReconnectFlushArgs = {
  enabled: boolean;
  flush: () => Promise<void>;
  afterFlush?: () => void | Promise<void>;
};

/**
 * Shared reconnect handler for offline outbox domains.
 * Returns a `syncing` flag so callers can show in-flight state/toasts.
 */
export function useOfflineReconnectFlush({
  enabled,
  flush,
  afterFlush,
}: UseOfflineReconnectFlushArgs): boolean {
  const [syncing, setSyncing] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const run = useCallback(async () => {
    setSyncing(true);
    try {
      await wgwAwaitSessionRefreshForReconnect();
      await flush();
      if (afterFlush) await afterFlush();
    } finally {
      setSyncing(false);
    }
  }, [afterFlush, flush]);

  useOnReconnect(
    useCallback(() => {
      if (!enabled) return;
      clearTimer();
      const wait = randomSpreadMs(RECONNECT_FLUSH_SPREAD_MS);
      const start = () => {
        timerRef.current = null;
        // Offline again during the wait: the next offline→online edge flushes instead.
        if (!enabledRef.current || !getConnectivitySnapshot()) return;
        void run();
      };
      if (wait > 0) timerRef.current = window.setTimeout(start, wait);
      else start();
    }, [clearTimer, enabled, run]),
  );

  return syncing;
}
