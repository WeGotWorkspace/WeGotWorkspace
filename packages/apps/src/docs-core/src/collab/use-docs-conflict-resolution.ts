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
  /** `"gone"` reuses this dialog for a deleted document. Both actions keep the local copy. */
  mode: "conflict" | "gone";
  setOpen: (open: boolean) => void;
  reportDocumentGone: () => void;
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
  const [mode, setMode] = useState<"conflict" | "gone" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDocsSyncConflictListener((paths) => {
      if (paths.includes(room ?? "")) setMode("conflict");
    });
    return () => setDocsSyncConflictListener(undefined);
  }, [room]);

  const setOpen = useCallback((open: boolean) => {
    setMode(open ? "conflict" : null);
  }, []);

  const reportDocumentGone = useCallback(() => {
    setMode("gone");
  }, []);

  const keepLocal = useCallback(() => {
    if (mode === "gone") {
      setMode(null);
      return;
    }
    setBusy(true);
    void resolveDocsConflictKeepLocal(saveNow)
      .then(() => {
        setMode(null);
        reportDocsSyncConflicts([]);
      })
      .finally(() => setBusy(false));
  }, [mode, saveNow]);

  const useServer = useCallback(() => {
    if (mode === "gone") {
      setMode(null);
      return;
    }
    if (!ydoc || !yjsUrl) return;
    setBusy(true);
    void resolveDocsConflictUseServer(ydoc, yjsUrl, authToken, room)
      .then(() => {
        setMode(null);
        onServerApplied();
      })
      .finally(() => setBusy(false));
  }, [authToken, mode, onServerApplied, room, ydoc, yjsUrl]);

  return {
    open: mode !== null,
    mode: mode ?? "conflict",
    setOpen,
    reportDocumentGone,
    busy,
    keepLocal,
    useServer,
  };
}
