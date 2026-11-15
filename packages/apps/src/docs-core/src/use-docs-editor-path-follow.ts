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

/**
 * Whether a queued create or rename still owns `filePath`; re-read when Docs
 * caches change. `undefined` until the read answers (or when it fails).
 * `learn(path)` answers for a path before the editor opens it, so a followed
 * move does not start the new path unknown (and its room local-only).
 */
function useQueuedWriteOwnsPath(username: string | null | undefined, filePath: string | null) {
  const [answer, setAnswer] = useState<{ path: string; owned: boolean } | null>(null);
  /** The path `learn` answered for, until the editor is on it. */
  const learnedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (learnedPathRef.current === filePath) learnedPathRef.current = null;
    if (!username || !filePath) return;
    let cancelled = false;
    const key = docsSourceKey(filePath);
    const check = () => {
      void readDocsPendingWrites(username)
        .then((pending) => {
          // A later answer for the path the editor is about to open wins.
          if (cancelled || learnedPathRef.current) return;
          setAnswer({ path: filePath, owned: docsRowOwnedByQueuedWrite(pending, key) });
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
  const learn = useCallback(
    async (path: string) => {
      if (!username) return;
      const pending = await readDocsPendingWrites(username);
      learnedPathRef.current = path;
      setAnswer({ path, owned: docsRowOwnedByQueuedWrite(pending, docsSourceKey(path)) });
    },
    [username],
  );
  return { owned: answer?.path === filePath ? answer.owned : undefined, learn };
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
}: UseDocsEditorPathFollowArgs): { holdServerSave: boolean; holdUntilChecked: boolean } {
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

  const { owned: ownedByQueuedWrite, learn: learnQueuedOwner } = useQueuedWriteOwnsPath(
    editorUsername,
    filePath,
  );

  useEffect(() => {
    if (!editorUsername || !filePath) return;
    return subscribeDocsPathMoved(editorUsername, (from, to) => {
      const next = docsPathAfterMove(filePath, from, to);
      if (!next) return;
      setFollowPending(true);
      const target = `/${next}`;
      // A failed read follows anyway; the new path then holds until a read answers.
      void learnQueuedOwner(target)
        .catch(() => undefined)
        .finally(() => onFollow(target));
    });
  }, [editorUsername, filePath, learnQueuedOwner, onFollow]);

  useEffect(() => setFollowPending(false), [filePath]);

  const holdServerSave =
    Boolean(editorUsername) && (ownedByQueuedWrite !== false || awaitingPathCheck || followPending);
  return {
    holdServerSave,
    // Held while a check is out, not because a queued write owns the path.
    holdUntilChecked: holdServerSave && ownedByQueuedWrite !== true,
  };
}
