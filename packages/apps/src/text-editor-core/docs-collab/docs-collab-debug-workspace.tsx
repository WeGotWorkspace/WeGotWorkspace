import { DocsCollabEditorSurface } from "./docs-collab-editor-surface";
import { useDocsCollab } from "./use-docs-collab";

export type DocsCollabWorkspaceProps = {
  userName: string;
  autoJoin?: boolean;
};

export function DocsCollabWorkspace({ userName, autoJoin = true }: DocsCollabWorkspaceProps) {
  const {
    session,
    joined,
    status,
    docStatus,
    peers,
    connectingPeers,
    warningPeers,
    linkCount,
    join,
    leave,
    saveNow,
    onMarkdownChange,
  } = useDocsCollab({ userName, autoJoin });

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Name</span>
          <input
            type="text"
            value={userName}
            readOnly
            className="w-32 rounded border bg-muted/40 px-2 py-1 font-medium"
            title="Set via Storybook controls"
          />
        </label>
        {!autoJoin ? (
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
            disabled={joined}
            onClick={() => void join()}
          >
            Join
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border px-3 py-1 disabled:opacity-50"
          disabled={!joined}
          onClick={() => void leave()}
        >
          Leave
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1 disabled:opacity-50"
          disabled={!joined}
          onClick={() => void saveNow()}
        >
          Save
        </button>
        <span className="text-muted-foreground">{status}</span>
        {docStatus ? <span className="text-muted-foreground">· {docStatus}</span> : null}
        <span className="ml-auto text-muted-foreground">
          {linkCount === 1 ? "1 connection" : `${linkCount} connections`} · {peers.length} connected
          · {connectingPeers.length} connecting · {warningPeers.length} warning
        </span>
      </header>

      <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
        Open this story in <strong>two browser windows</strong> (or Storybook + iframe) with
        different <strong>userName</strong> controls — e.g. Alex and Sam. A local room service on{" "}
        <strong>8081</strong> has to be running (Storybook starts it, or{" "}
        <code>pnpm dev:docs-collab-signal</code>). Verbose diagnostics: Admin → Real-time
        collaboration → Detailed connection logs.
      </div>

      <main className="flex-1 p-4">
        {session ? (
          <DocsCollabEditorSurface
            ydoc={session.ydoc}
            awareness={session.awareness}
            user={session.user}
            onMarkdownChange={onMarkdownChange}
          />
        ) : (
          <p className="text-muted-foreground">Join to start editing…</p>
        )}
      </main>
    </div>
  );
}
