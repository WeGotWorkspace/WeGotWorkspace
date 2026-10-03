import { useCallback, useEffect, useState } from "react";
import type * as Y from "yjs";
import {
  resolveDocsConflictKeepLocal,
  resolveDocsConflictUseServer,
} from "@/lib/offline/docs/docs-conflict-resolution";
import {
  reportDocsSyncConflicts,
  setDocsSyncConflictListener,
} from "@/lib/offline/docs/docs-sync-conflicts";

export type DocsConflictResolutionInput = {
  /** Document room; only conflicts reported for this path open the dialog. */
  room: string | undefined;
  ydoc: Y.Doc | null;
  yjsUrl: string | undefined;
  authToken: string | undefined;
  saveNow: () => Promise<void>;
  /** Called after the server snapshot replaced the local document. */
  onServerApplied: () => void;
};

export type DocsConflictResolution = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** A resolution is in flight — keeps both dialog buttons busy. */
  busy: boolean;
  keepLocal: () => void;
  useServer: () => void;
};

/**
 * Owns the save-conflict dialog for one document: opening it when the offline
 * sync queue reports a conflict on this room, and the two ways out of it.
 */
export function useDocsConflictResolution({
  room,
  ydoc,
  yjsUrl,
  authToken,
  saveNow,
  onServerApplied,
}: DocsConflictResolutionInput): DocsConflictResolution {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDocsSyncConflictListener((paths) => {
      if (paths.includes(room ?? "")) setOpen(true);
    });
    return () => setDocsSyncConflictListener(undefined);
  }, [room]);

  const keepLocal = useCallback(() => {
    setBusy(true);
    void resolveDocsConflictKeepLocal(saveNow)
      .then(() => {
        setOpen(false);
        reportDocsSyncConflicts([]);
      })
      .finally(() => setBusy(false));
  }, [saveNow]);

  const useServer = useCallback(() => {
    if (!ydoc || !yjsUrl) return;
    setBusy(true);
    void resolveDocsConflictUseServer(ydoc, yjsUrl, authToken)
      .then(() => {
        setOpen(false);
        onServerApplied();
      })
      .finally(() => setBusy(false));
  }, [authToken, onServerApplied, ydoc, yjsUrl]);

  return { open, setOpen, busy, keepLocal, useServer };
}
