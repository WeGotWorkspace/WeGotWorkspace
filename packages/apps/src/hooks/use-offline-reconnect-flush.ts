import { useCallback, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { wgwAwaitSessionRefreshForReconnect } from "@/lib/api/wgw/http";
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

  useOnReconnect(
    useCallback(() => {
      if (!enabled) return;
      void (async () => {
        const wait = randomSpreadMs(RECONNECT_FLUSH_SPREAD_MS);
        if (wait > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, wait));
        setSyncing(true);
        try {
          await wgwAwaitSessionRefreshForReconnect();
          await flush();
          if (afterFlush) await afterFlush();
        } finally {
          setSyncing(false);
        }
      })();
    }, [afterFlush, enabled, flush]),
  );

  return syncing;
}
