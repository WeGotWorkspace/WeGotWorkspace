type LiveBootstrapErrorPanelProps = {
  title: string;
  error: string | null;
  onRetry: () => void;
};

export function LiveBootstrapErrorPanel({ title, error, onRetry }: LiveBootstrapErrorPanelProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-8 text-[var(--workspace-foreground)]">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-[color-mix(in_oklab,var(--workspace-foreground)_70%,transparent)]">
        {error}
      </p>
      <p className="text-xs text-[color-mix(in_oklab,var(--workspace-foreground)_55%,transparent)]">
        Use{" "}
        <code className="rounded bg-[color-mix(in_oklab,var(--workspace-foreground)_8%,transparent)] px-1">
          .env.local
        </code>{" "}
        from{" "}
        <code className="rounded bg-[color-mix(in_oklab,var(--workspace-foreground)_8%,transparent)] px-1">
          .env.example
        </code>{" "}
        (proxy + credentials), then restart <code className="rounded px-1">npm run dev</code>.
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
