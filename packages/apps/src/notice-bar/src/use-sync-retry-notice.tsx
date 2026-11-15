import { CloudOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { ActionNotice } from "@/notice-bar/src/notice-bar";

type UseSyncRetryNoticeArgs = {
  /** Stable row id, e.g. `sync:notes`. */
  id: string;
  /** True while the app has changes that could not sync. */
  active: boolean;
  /** One sentence: what waits and where (`workspaceLabels.sync.failedNotice`). */
  title: string;
  retryLabel: string;
  /** Flushes the outbox again. Retry stays disabled until the returned promise settles. */
  onRetry: () => Promise<unknown> | void;
};

/**
 * The notice bar row while an app's queued changes fail to sync (#1895). It
 * replaces the old sync toast: the row stays until `active` turns false, so
 * it cannot be dismissed by accident.
 */
export function useSyncRetryNotice({
  id,
  active,
  title,
  retryLabel,
  onRetry,
}: UseSyncRetryNoticeArgs): ActionNotice | null {
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(() => {
    setRetrying(true);
    void Promise.resolve()
      .then(onRetry)
      .catch(() => undefined)
      .finally(() => setRetrying(false));
  }, [onRetry]);

  return useMemo(
    () => (active ? syncRetryNotice({ id, title, retryLabel, onRetry: retry, retrying }) : null),
    [active, id, retry, retryLabel, retrying, title],
  );
}

/** A stuck-sync row: error tone, offline icon, Retry. */
export function syncRetryNotice({
  id,
  title,
  retryLabel,
  onRetry,
  retrying = false,
}: {
  id: string;
  title: string;
  retryLabel: string;
  onRetry: () => void;
  retrying?: boolean;
}): ActionNotice {
  return {
    id,
    tone: "error",
    icon: <CloudOff className="callout__icon" aria-hidden />,
    title,
    actionLabel: retryLabel,
    onAction: onRetry,
    actionDisabled: retrying,
  };
}
