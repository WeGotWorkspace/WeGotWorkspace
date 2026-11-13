import { useCallback, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { wgwAwaitSessionRefreshForReconnect } from "@/lib/api/wgw/http";

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
