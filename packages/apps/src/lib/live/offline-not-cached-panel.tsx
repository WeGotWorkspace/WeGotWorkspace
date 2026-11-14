import { useEffect } from "react";

type OfflineNotCachedPanelProps = {
  onRetry: () => void;
};

/**
 * An app opened offline before its first online visit on this device (#2100).
 * Not a load failure: there is nothing cached yet. Retries on its own when the
 * connection comes back.
 */
export function OfflineNotCachedPanel({ onRetry }: OfflineNotCachedPanelProps) {
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);

  return (
    <div
      role="status"
      className="mx-auto flex max-w-md flex-col gap-4 p-8 text-[var(--workspace-foreground)]"
    >
      <p className="text-sm font-medium">Not available offline yet</p>
      <p className="text-sm text-[color-mix(in_oklab,var(--workspace-foreground)_70%,transparent)]">
        Open this app once while you're online. After that it works offline too.
      </p>
      <button
        type="button"
        className="self-start rounded-md border border-[color-mix(in_oklab,var(--workspace-foreground)_20%,transparent)] px-3 py-1.5 text-sm hover:bg-[color-mix(in_oklab,var(--workspace-foreground)_6%,transparent)]"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
