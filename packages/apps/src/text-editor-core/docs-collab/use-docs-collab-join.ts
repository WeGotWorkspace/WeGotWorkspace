import { useCallback, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { getConnectivitySnapshot, isFetchNetworkError } from "@/lib/offline/browser-online";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { clearDocsCollabSyncState } from "./docs-collab-sync-registry";
import { clearDocsCollabPendingServerSave } from "./docs-collab-persistence";
import { createTeardownResetState, isJoinGenerationCurrent } from "./docs-collab-join-lifecycle";
import { encodeAwarenessBroadcast, encodeUpdateBroadcast } from "./docs-collab-mesh-sync";
import {
  markRoomServerFailure,
  markRoomServerSuccess,
  roomServerAllowed,
} from "./docs-collab-room-backoff";
import { loadMarkdown, loadYjsSnapshot, saveDocument } from "./docs-collab-server-io";
import {
  canSeedFromFile,
  resolveBootstrapSeed,
  shouldApplyImmediateSeed,
} from "./docs-collab-seed";
import {
  DOC_STATUS_LOADED_SHARED_DOCUMENT,
  DOC_STATUS_RESTORED_WORKING_VERSION,
} from "./docs-collab-status";
import type { DocsCollabSession, DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";
import {
  BC_TAB_ORIGIN,
  collabDocumentFormat,
  colorForName,
  docSignature,
  isRemoteUpdateOrigin,
  isYDocEmpty,
  MESH_ORIGIN,
  SERVER_ORIGIN,
} from "./docs-collab-utils";
import { trackChangesAuthorIdFromName } from "@/text-editor-core/src/text-editor-track-changes";
import { PENDING_SERVER_SAVE_KEY } from "./use-docs-collab-save";

type MeshApi = Pick<
  ReturnType<typeof import("./use-docs-collab-mesh").useDocsCollabMesh>,
  "joinMesh" | "refreshMeshUi" | "resetMeshUi" | "setStatus" | "setConnectingPeers"
>;

type SaveApi = Pick<
  ReturnType<typeof import("./use-docs-collab-save").useDocsCollabSave>,
  "updatePendingState" | "flushPendingSaveIfReady"
>;

type UseDocsCollabJoinOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  urls: DocsCollabUrls;
  userName: string;
  mesh: MeshApi;
  save: SaveApi;
  setDocStatus: (status: string | ((prev: string) => string)) => void;
  setPendingSync: (pending: boolean) => void;
  setFailedSync: (failed: boolean) => void;
};

export function useDocsCollabJoin({
  refs,
  room,
  urls,
  userName,
  mesh,
  save,
  setDocStatus,
  setPendingSync,
  setFailedSync,
}: UseDocsCollabJoinOptions) {
  const { joinMesh, refreshMeshUi, resetMeshUi, setStatus, setConnectingPeers } = mesh;
  const { updatePendingState, flushPendingSaveIfReady } = save;
  const documentFormat = collabDocumentFormat(room);
  const [session, setSession] = useState<DocsCollabSession | null>(null);
  const [joined, setJoined] = useState(false);
  const meshJoinInFlightRef = useRef(false);

  const markDocReady = useCallback(() => {
    refs.seedDoneRef.current = true;
  }, [refs]);

  const trySeedFromFile = useCallback(() => {
    const ydoc = refs.ydocRef.current;
    const meshSession = refs.meshRef.current;
    const markdown = refs.pendingMarkdownRef.current;
    if (!ydoc || !markdown || refs.seedDoneRef.current) return;
    if (!isYDocEmpty(ydoc)) {
      markDocReady();
      return;
    }

    if (!meshSession) {
      applyContentSeedToYDoc(ydoc, markdown, documentFormat);
      markDocReady();
      setDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT);
      return;
    }

    const peerIds = meshSession.getPeerIds();
    if (!canSeedFromFile(meshSession, meshSession.getMyId(), peerIds)) return;

    applyContentSeedToYDoc(ydoc, markdown, documentFormat);
    markDocReady();
    setDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT);
  }, [documentFormat, markDocReady, refs, setDocStatus]);

  const teardown = useCallback(() => {
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    if (refs.seedTimerRef.current) clearTimeout(refs.seedTimerRef.current);
    const meshSession = refs.meshRef.current;
    refs.meshRef.current = null;
    meshJoinInFlightRef.current = false;
    void meshSession?.leave();
    const persistence = refs.persistenceRef.current;
    refs.persistenceRef.current = null;
    void persistence?.destroy();
    refs.ydocRef.current = null;
    refs.awarenessRef.current = null;
    const reset = createTeardownResetState();
    refs.seedDoneRef.current = reset.seedDone;
    refs.localDirtySinceLastSaveRef.current = reset.localDirtySinceLastSave;
    refs.pendingServerSaveRef.current = reset.pendingServerSave;
    refs.lastKnownMarkdownRef.current = reset.lastKnownMarkdown;
    refs.lastSuccessfulSaveSignatureRef.current = reset.lastSuccessfulSaveSignature;
    refs.saveFailedRef.current = reset.saveFailed;
    refs.saveInFlightRef.current = reset.saveInFlight;
    refs.saveRetryMsRef.current = reset.saveRetryMs;
    refs.nextSaveAttemptAtRef.current = reset.nextSaveAttemptAt;
    refs.reconnectInFlightRef.current = reset.reconnectInFlight;
    refs.joinedRoomRef.current = reset.joinedRoom;
    refs.authTokenRef.current = reset.authToken;
    clearDocsCollabSyncState(room);
    setSession(null);
    setJoined(false);
    resetMeshUi();
    setDocStatus("");
    setPendingSync(false);
    setFailedSync(false);
  }, [refs, room, setDocStatus, setFailedSync, setPendingSync, resetMeshUi]);

  const mergeServerState = useCallback(
    async (authToken: string | undefined): Promise<boolean> => {
      const ydoc = refs.ydocRef.current;
      if (!ydoc) return false;
      return loadYjsSnapshot(urls.yjsUrl, ydoc, authToken, SERVER_ORIGIN);
    },
    [refs, urls.yjsUrl],
  );

  const applyServerBootstrap = useCallback(
    async (generation: number, authToken: string | undefined) => {
      const ydoc = refs.ydocRef.current;
      if (!ydoc || !isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;

      let markdown = "";
      let hadSnapshot = false;
      try {
        markdown = await loadMarkdown(urls.documentUrl, authToken);
      } catch (error) {
        markRoomServerFailure(room);
        console.warn("[docs-collab] markdown load failed", error);
      }
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
      try {
        hadSnapshot = await loadYjsSnapshot(urls.yjsUrl, ydoc, authToken, SERVER_ORIGIN);
      } catch (error) {
        markRoomServerFailure(room);
        console.warn("[docs-collab] yjs load failed", error);
      }
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
      if (hadSnapshot) refs.seedDoneRef.current = true;
      if (hadSnapshot || markdown) {
        markRoomServerSuccess(room);
      }

      const seed = resolveBootstrapSeed(markdown, refs.seedContentRef.current);
      refs.pendingMarkdownRef.current = seed;
      refs.lastKnownMarkdownRef.current = markdown;
      refs.lastSuccessfulSaveSignatureRef.current = docSignature(markdown, ydoc);
      refs.localDirtySinceLastSaveRef.current = false;

      if (!refs.seedDoneRef.current && isYDocEmpty(ydoc)) {
        const meshSession = refs.meshRef.current;
        if (shouldApplyImmediateSeed(meshSession, ydoc, refs.seedDoneRef.current, seed)) {
          applyContentSeedToYDoc(ydoc, seed, documentFormat);
          markDocReady();
          setDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT);
        } else if (meshSession && meshSession.getPeerIds().length > 0) {
          const tick = () => trySeedFromFile();
          refs.seedTimerRef.current = setTimeout(tick, 1000);
          setTimeout(tick, 3000);
        }
      } else if (hadSnapshot) {
        setDocStatus(DOC_STATUS_RESTORED_WORKING_VERSION);
      }
    },
    [
      documentFormat,
      markDocReady,
      refs,
      room,
      setDocStatus,
      trySeedFromFile,
      urls.documentUrl,
      urls.yjsUrl,
    ],
  );

  const connectMeshInBackground = useCallback(
    async (generation: number, name: string, authToken: string) => {
      if (refs.meshRef.current || meshJoinInFlightRef.current) return;
      meshJoinInFlightRef.current = true;
      setDocStatus((prev) => prev || "Connecting to collaborators…");
      setStatus("Connecting to mesh…");
      try {
        const meshPeers = await joinMesh(name, authToken);
        if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
        setConnectingPeers(meshPeers);
        refreshMeshUi();
        setDocStatus((prev) => (prev === "Connecting to collaborators…" ? "" : prev));
        trySeedFromFile();
      } catch (error) {
        if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
        markRoomServerFailure(room);
        console.warn("[docs-collab] mesh join failed", error);
        setDocStatus(error instanceof Error ? error.message : String(error));
      } finally {
        meshJoinInFlightRef.current = false;
      }
    },
    [
      joinMesh,
      refs,
      refreshMeshUi,
      room,
      setConnectingPeers,
      setDocStatus,
      setStatus,
      trySeedFromFile,
    ],
  );

  const join = useCallback(async () => {
    if (refs.joinedRoomRef.current === room && refs.sessionRef.current) return;
    const generation = ++refs.joinGenerationRef.current;
    const name = userName.trim();
    if (!name) {
      setStatus("Enter a display name");
      return;
    }
    teardown();

    const online = getConnectivitySnapshot();
    const allowServerRequests = online && roomServerAllowed(room);
    refs.seedDoneRef.current = false;
    setDocStatus("");

    const ydoc = new Y.Doc();
    refs.ydocRef.current = ydoc;
    const persistence = new IndexeddbPersistence(room, ydoc);
    refs.persistenceRef.current = persistence;

    const authTokenPromise = allowServerRequests
      ? refs.wireRef.current
          .fetchAuthToken({
            authToken: urls.authToken,
            authTokenUrl: urls.authTokenUrl,
            authUser: urls.authUser,
            authPassword: urls.authPassword,
          })
          .catch((error) => {
            markRoomServerFailure(room);
            if (online && !isFetchNetworkError(error)) throw error;
            console.warn("[docs-collab] auth unavailable, continuing with local cache", error);
            return undefined;
          })
      : Promise.resolve(undefined);

    await persistence.whenSynced;
    if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;

    const pendingSave = await persistence.get(PENDING_SERVER_SAVE_KEY);
    if (pendingSave) {
      await updatePendingState(true, false);
    }

    const awareness = new awarenessProtocol.Awareness(ydoc);
    refs.awarenessRef.current = awareness;
    const user = { name, color: colorForName(name), id: trackChangesAuthorIdFromName(name) };
    awareness.setLocalStateField("user", user);

    ydoc.on("update", (update, origin) => {
      if (isRemoteUpdateOrigin(origin, refs.persistenceRef.current)) return;
      refs.localDirtySinceLastSaveRef.current = true;
      const encoded = encodeUpdateBroadcast(update);
      const tabSync = refs.tabSyncRef.current;
      if (tabSync) {
        tabSync.onLocalSync(encoded);
        return;
      }
      refs.meshRef.current?.broadcast({ type: "sync", u: encoded });
    });

    awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin === MESH_ORIGIN || origin === BC_TAB_ORIGIN) return;
        const changed = added.concat(updated, removed);
        const encoded = encodeAwarenessBroadcast(awareness, changed);
        const tabSync = refs.tabSyncRef.current;
        if (tabSync) {
          tabSync.onLocalAwareness(encoded);
          return;
        }
        refs.meshRef.current?.broadcast({ type: "awareness", u: encoded });
      },
    );

    setSession({ ydoc, awareness, user });
    setJoined(true);
    refs.joinedRoomRef.current = room;

    if (!online || !allowServerRequests) {
      if (!refs.seedDoneRef.current && isYDocEmpty(ydoc) && refs.seedContentRef.current) {
        applyContentSeedToYDoc(ydoc, refs.seedContentRef.current, documentFormat);
        markDocReady();
      }
      setStatus("Editing offline");
      setDocStatus(online ? "Server unavailable, using local draft" : "Editing offline");
      void authTokenPromise.then((token) => {
        if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
        refs.authTokenRef.current = token;
      });
      return;
    }

    void (async () => {
      let authToken: string | undefined;
      try {
        authToken = await authTokenPromise;
      } catch (error) {
        if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
        setDocStatus(error instanceof Error ? error.message : String(error));
        return;
      }
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
      refs.authTokenRef.current = authToken;

      await applyServerBootstrap(generation, authToken);
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
      if (authToken && refs.tabSyncRef.current?.isMeshLeader()) {
        await connectMeshInBackground(generation, name, authToken);
      }
      flushPendingSaveIfReady();
    })();
  }, [
    applyServerBootstrap,
    connectMeshInBackground,
    documentFormat,
    flushPendingSaveIfReady,
    joinMesh,
    markDocReady,
    refs,
    room,
    setDocStatus,
    setStatus,
    teardown,
    updatePendingState,
    urls.authPassword,
    urls.authToken,
    urls.authTokenUrl,
    urls.authUser,
    userName,
  ]);

  const leave = useCallback(async () => {
    const getMd = refs.getMarkdownRef.current;
    const ydoc = refs.ydocRef.current;
    let saved = false;
    if (getMd && ydoc) {
      try {
        await saveDocument(
          urls.documentUrl,
          getMd(),
          ydoc,
          urls.room,
          refs.authTokenRef.current,
          urls.documentSaveMethod ?? "POST",
        );
        saved = true;
      } catch {
        // ignore
      }
    }
    if (saved) {
      await clearDocsCollabPendingServerSave(room);
    }
    await teardown();
  }, [refs, room, teardown, urls.documentSaveMethod, urls.documentUrl, urls.room]);

  return {
    session,
    joined,
    join,
    leave,
    teardown,
    markDocReady,
    trySeedFromFile,
    mergeServerState,
    applyServerBootstrap,
    connectMeshInBackground,
    setSession,
    setJoined,
  };
}
