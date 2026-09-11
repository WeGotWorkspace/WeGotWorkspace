import { useCallback, useEffect, useRef, useState } from "react";
import { resetDocsCollabBackoffForTests } from "./docs-collab-room-backoff";
import { isTransientDocStatus, TRANSIENT_DOC_STATUS_DISMISS_MS } from "./docs-collab-status";
import {
  DEFAULT_DOCS_COLLAB_URLS,
  type DocsCollabUrls,
  type UseDocsCollabOptions,
} from "./docs-collab-types";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";
import { useDocsCollabJoin } from "./use-docs-collab-join";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabReconnect } from "./use-docs-collab-reconnect";
import { useDocsCollabSave } from "./use-docs-collab-save";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";
import { useDocsCollabTabSync } from "./use-docs-collab-tab-sync";
import { docsCollabRoomKey } from "./docs-collab-persistence";

export {
  DEFAULT_DOCS_COLLAB_URLS,
  type DocsCollabSession,
  type DocsCollabUrls,
  type UseDocsCollabOptions,
} from "./docs-collab-types";
export {
  MESH_ORIGIN,
  BC_TAB_ORIGIN,
  SEED_ORIGIN,
  SERVER_ORIGIN,
  IDB_ORIGIN,
} from "./docs-collab-utils";
export { resetDocsCollabBackoffForTests };

export function useDocsCollab({
  userName,
  autoJoin = true,
  urls: inputUrls = DEFAULT_DOCS_COLLAB_URLS,
  wire = DEFAULT_DOCS_COLLAB_WIRE,
  seedContent,
}: UseDocsCollabOptions) {
  const urls: DocsCollabUrls = {
    ...DEFAULT_DOCS_COLLAB_URLS,
    ...(inputUrls ?? {}),
  };
  const room = docsCollabRoomKey(urls.room ?? "docs/test-together.md");

  const refs = useDocsCollabSessionRefs(wire, seedContent);
  const [docStatus, setDocStatus] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [failedSync, setFailedSync] = useState(false);

  const markDocReadyRef = useRef<() => void>(() => undefined);
  const trySeedFromFileRef = useRef<() => void>(() => undefined);
  const markDocReadyStable = useCallback(() => {
    markDocReadyRef.current();
  }, []);
  const trySeedFromFileStable = useCallback(() => {
    trySeedFromFileRef.current();
  }, []);

  const save = useDocsCollabSave({
    refs,
    room,
    urls,
    setDocStatus,
    setLastSavedAt,
    setPendingSync,
    setFailedSync,
  });

  const mesh = useDocsCollabMesh({
    refs,
    room,
    urls,
    markDocReady: markDocReadyStable,
    trySeedFromFile: trySeedFromFileStable,
  });

  const joinHook = useDocsCollabJoin({
    refs,
    room,
    urls,
    userName,
    mesh,
    save,
    setDocStatus,
    setLastSavedAt,
    setPendingSync,
    setFailedSync,
  });

  markDocReadyRef.current = joinHook.markDocReady;
  trySeedFromFileRef.current = joinHook.trySeedFromFile;

  useDocsCollabTabSync({
    refs,
    room,
    userName,
    joined: joinHook.joined,
    mesh,
    join: joinHook,
    tabSyncRef: refs.tabSyncRef,
  });

  const { join, leave, teardown, session, joined } = joinHook;
  const { saveNow, registerMarkdownGetter, onMarkdownChange } = save;

  const joinRef = useRef(join);
  const teardownRef = useRef(teardown);
  joinRef.current = join;
  teardownRef.current = teardown;

  useDocsCollabReconnect({
    refs,
    room,
    urls,
    userName,
    joined: joinHook.joined,
    mesh,
    save,
    join: joinHook,
    setDocStatus,
  });

  useEffect(() => {
    refs.sessionRef.current = session;
  }, [session, refs]);

  useEffect(() => {
    if (!isTransientDocStatus(docStatus)) return;
    const statusAtSchedule = docStatus;
    const timer = setTimeout(() => {
      setDocStatus((prev) => (prev === statusAtSchedule ? "" : prev));
    }, TRANSIENT_DOC_STATUS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [docStatus]);

  useEffect(() => {
    if (autoJoin && userName.trim()) {
      void joinRef.current().catch((error) => {
        console.warn("[docs-collab] join failed", error);
        setDocStatus(error instanceof Error ? error.message : String(error));
      });
    }
    return () => {
      refs.joinGenerationRef.current += 1;
      teardownRef.current();
    };
  }, [autoJoin, userName, refs]);

  return {
    session,
    joined,
    status: mesh.status,
    docStatus,
    lastSavedAt,
    peers: mesh.peers,
    connectingPeers: mesh.connectingPeers,
    warningPeers: mesh.warningPeers,
    linkCount: mesh.linkCount,
    pendingSync,
    failedSync,
    join,
    leave,
    saveNow,
    registerMarkdownGetter,
    onMarkdownChange,
  };
}
