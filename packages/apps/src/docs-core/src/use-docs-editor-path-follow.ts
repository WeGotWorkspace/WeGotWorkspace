import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectivity, useOnReconnect } from "@/hooks/use-connectivity";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { docsRowOwnedByQueuedWrite, docsSourceKey } from "@/lib/offline/docs/docs-inbound-plan";
import {
  readDocsPendingWrites,
  subscribeDocsCachesChanged,
} from "@/lib/offline/docs/docs-inbound-sync";
import { docsPathAfterMove, subscribeDocsPathMoved } from "@/lib/offline/docs/docs-path-moves";
import { useDriveFileNodeInbound } from "@/lib/offline/drive/use-drive-file-node-inbound";

type UseDocsEditorPathFollowArgs = {
  /** Offline account; without one nothing is held or followed. */
  username: string | null | undefined;
  /** API path of the open Doc, or null on the Docs home. */
  filePath: string | null;
  /** Open the Doc at its new path (replace the history entry). */
  onFollow: (apiPath: string) => void;
};

/** Whether a queued create or rename still owns `filePath`; re-read when Docs caches change. */
function useQueuedWriteOwnsPath(username: string | null | undefined, filePath: string | null) {
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    if (!username || !filePath) {
      setOwned(false);
      return;
    }
    let cancelled = false;
    const key = docsSourceKey(filePath);
    const check = () => {
      void readDocsPendingWrites(username)
        .then((pending) => {
          if (!cancelled) setOwned(docsRowOwnedByQueuedWrite(pending, key));
        })
        .catch(() => undefined);
    };
    check();
    const unsubscribe = subscribeDocsCachesChanged(username, check);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [filePath, username]);
  return owned;
}

/**
 * The open Doc follows its file (#1563). When it moves (renamed or moved in
 * another tab, on another device, or kept as "name (1)" because its offline
 * create met a taken name), the editor opens the new path. Its text is held
 * on this device, not saved, while the server does not have the path yet (a
 * queued create or rename owns it) and, after being offline, until the first
 * FileNode pull tells whether the file moved meanwhile and, when it did, until
 * the editor is on the new path. So unsaved text never lands in a new file at
 * the old path.
 */
export function useDocsEditorPathFollow({
  username,
  filePath,
  onFollow,
}: UseDocsEditorPathFollowArgs): { holdServerSave: boolean } {
  const editorUsername = filePath ? username : undefined;
  const { online } = useConnectivity();
  const [inboundKey, setInboundKey] = useState(0);
  const latestInboundKeyRef = useRef(0);
  // A followed move was announced; the open path is still the old one until it changes.
  const [followPending, setFollowPending] = useState(false);
  const [awaitingPathCheck, setAwaitingPathCheck] = useState(() => !getConnectivitySnapshot());

  useEffect(() => {
    if (!online) setAwaitingPathCheck(true);
  }, [online]);

  useOnReconnect(
    useCallback(() => {
      latestInboundKeyRef.current += 1;
      setInboundKey(latestInboundKeyRef.current);
    }, []),
  );

  useDriveFileNodeInbound(
    editorUsername,
    inboundKey,
    useCallback((settledKey: number) => {
      if (settledKey !== latestInboundKeyRef.current || !getConnectivitySnapshot()) return;
      setAwaitingPathCheck(false);
    }, []),
  );

  useEffect(() => {
    if (!editorUsername || !filePath) return;
    return subscribeDocsPathMoved(editorUsername, (from, to) => {
      const next = docsPathAfterMove(filePath, from, to);
      if (!next) return;
      setFollowPending(true);
      onFollow(`/${next}`);
    });
  }, [editorUsername, filePath, onFollow]);

  useEffect(() => setFollowPending(false), [filePath]);

  const ownedByQueuedWrite = useQueuedWriteOwnsPath(editorUsername, filePath);
  return {
    holdServerSave:
      Boolean(editorUsername) && (ownedByQueuedWrite || awaitingPathCheck || followPending),
  };
}
