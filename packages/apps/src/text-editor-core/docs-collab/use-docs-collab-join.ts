import { useCallback, useEffect, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { getConnectivitySnapshot, isFetchNetworkError } from "@/lib/offline/browser-online";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { clearDocsCollabSyncState } from "./docs-collab-sync-registry";
import {
  docsCollabPathKeyedSources,
  migrateDocsCollabPendingSaveFromLegacy,
  resolveDocsCollabDatabase,
} from "./docs-collab-persistence";
import { createTeardownResetState, isJoinGenerationCurrent } from "./docs-collab-join-lifecycle";
import { lingerDocsCollabMeshSession } from "./docs-collab-mesh-linger";
import { encodeAwarenessBroadcast, encodeUpdateBroadcast } from "./docs-collab-mesh-sync";
import { mayPublishDocumentBearingMeshSync } from "./docs-collab-mesh-hydration";
import {
  markRoomServerFailure,
  markRoomServerSuccess,
  roomServerAllowed,
} from "./docs-collab-room-backoff";
import { fetchYjsSnapshot, loadCollabText } from "./docs-collab-server-io";
import { decideExternalWrite, replaceDocumentWithExternalText } from "./docs-collab-external-write";
import {
  adoptServerSnapshot,
  decideServerStateAdoption,
  loadBootstrapInParallel,
} from "./docs-collab-bootstrap";
import { forgetSidecarEtag, rememberSidecarEtag } from "./docs-collab-etag";
import {
  canSeedFromFile,
  markSeedDoneAfterSnapshot,
  resolveBootstrapSeed,
  shouldApplyImmediateSeed,
} from "./docs-collab-seed";
import {
  DOC_STATUS_DOCUMENT_GONE,
  DOC_STATUS_LOADED_SHARED_DOCUMENT,
  DOC_STATUS_RESTORED_WORKING_VERSION,
  DOC_STATUS_SNAPSHOT_UNAVAILABLE,
} from "./docs-collab-status";
import { isCollabDocumentGoneError } from "./docs-collab-utils";
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
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

type MeshApi = Pick<
  ReturnType<typeof import("./use-docs-collab-mesh").useDocsCollabMesh>,
  | "joinMesh"
  | "refreshMeshUi"
  | "resetMeshUi"
  | "setStatus"
  | "setConnectingPeers"
  | "flushMeshSyncIfHydrated"
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
  setLastSavedAt: (iso: string | null) => void;
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
  setLastSavedAt,
  setPendingSync,
  setFailedSync,
}: UseDocsCollabJoinOptions) {
  const {
    joinMesh,
    refreshMeshUi,
    resetMeshUi,
    setStatus,
    setConnectingPeers,
    flushMeshSyncIfHydrated,
  } = mesh;
  const { updatePendingState, flushPendingSaveIfReady } = save;
  const documentFormat = collabDocumentFormat(room);
  const [session, setSession] = useState<DocsCollabSession | null>(null);
  const [joined, setJoined] = useState(false);
  /** Markdown shown read-only while a failed sidecar must not enter the Y.Doc. */
  const [snapshotPreview, setSnapshotPreview] = useState<string | null>(null);
  const meshJoinInFlightRef = useRef<object | null>(null);
  const serverJoinStartedRef = useRef(false);
  const markDocReady = useCallback(() => {
    // A peer can fill the doc after a failed sidecar already showed the preview.
    setSnapshotPreview(null);
    if (refs.seedDoneRef.current) return;
    refs.seedDoneRef.current = true;
    flushMeshSyncIfHydrated();
  }, [flushMeshSyncIfHydrated, refs]);

  const trySeedFromFile = useCallback(() => {
    const ydoc = refs.ydocRef.current;
    const meshSession = refs.meshRef.current;
    const markdown = refs.pendingMarkdownRef.current;
    // An outside write is waiting on the person. Seeding the server markdown
    // here would overwrite the unsaved local document before they choose.
    if (refs.externalWriteHoldRef.current) return;
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
    const awareness = refs.awarenessRef.current;
    if (awareness) {
      awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], "teardown");
    }
    if (refs.saveTimerRef.current) clearTimeout(refs.saveTimerRef.current);
    if (refs.seedTimerRef.current) clearTimeout(refs.seedTimerRef.current);
    const meshSession = refs.meshRef.current;
    refs.meshRef.current = null;
    meshJoinInFlightRef.current = null;
    serverJoinStartedRef.current = false;
    // Park the mesh instead of leaving: returning to this room within the
    // grace resumes the live session (joinMesh); expiry performs the leave.
    if (meshSession) lingerDocsCollabMeshSession(room, meshSession);
    const persistence = refs.persistenceRef.current;
    refs.persistenceRef.current = null;
    void persistence?.destroy();
    refs.ydocRef.current = null;
    refs.awarenessRef.current = null;
    const reset = createTeardownResetState();
    refs.seedDoneRef.current = reset.seedDone;
    refs.localDirtySinceLastSaveRef.current = reset.localDirtySinceLastSave;
    refs.pendingServerSaveRef.current = reset.pendingServerSave;
    refs.externalWriteHoldRef.current = false;
    refs.externalWriteSeenRef.current = null;
    refs.markdownOverrideRef.current = null;
    refs.lastKnownMarkdownRef.current = reset.lastKnownMarkdown;
    refs.lastSuccessfulSaveSignatureRef.current = reset.lastSuccessfulSaveSignature;
    refs.saveFailedRef.current = reset.saveFailed;
    refs.saveInFlightRef.current = reset.saveInFlight;
    refs.saveRetryMsRef.current = reset.saveRetryMs;
    refs.nextSaveAttemptAtRef.current = reset.nextSaveAttemptAt;
    refs.saveTerminalKindRef.current = reset.saveTerminalKind;
    refs.reconnectInFlightRef.current = reset.reconnectInFlight;
    refs.joinedRoomRef.current = reset.joinedRoom;
    refs.authTokenRef.current = reset.authToken;
    clearDocsCollabSyncState(room);
    // The sidecar may move on while the room is parked; re-learn it on rejoin.
    forgetSidecarEtag(room);
    refs.sessionRef.current = null;
    setSession(null);
    setJoined(false);
    setSnapshotPreview(null);
    resetMeshUi();
    setDocStatus("");
    setLastSavedAt(null);
    setPendingSync(false);
    setFailedSync(false);
  }, [refs, room, setDocStatus, setFailedSync, setLastSavedAt, setPendingSync, resetMeshUi]);

  useEffect(() => {
    // pagehide also runs when the page enters the back/forward cache. Keep the
    // cursor we clear so a persisted pageshow can put it back. A real teardown
    // nulls the awareness ref and drops this listener, so that path stays gone.
    let parked: {
      awareness: awarenessProtocol.Awareness;
      state: NonNullable<ReturnType<awarenessProtocol.Awareness["getLocalState"]>>;
    } | null = null;
    const onPageHide = () => {
      const awareness = refs.awarenessRef.current;
      if (!awareness) return;
      const state = awareness.getLocalState();
      if (state !== null) parked = { awareness, state };
      awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], "teardown");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !parked) return;
      const saved = parked;
      parked = null;
      if (refs.awarenessRef.current !== saved.awareness) return;
      saved.awareness.setLocalState(saved.state);
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      parked = null;
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refs]);

  const mergeServerState = useCallback(
    async (authToken: string | undefined): Promise<boolean> => {
      const ydoc = refs.ydocRef.current;
      if (!ydoc) return false;
      const snapshot = await fetchYjsSnapshot(urls.yjsUrl, authToken);
      rememberSidecarEtag(room, snapshot.etag);
      if (!snapshot.update) return false;

      const pendingLocalWork =
        refs.pendingServerSaveRef.current || refs.localDirtySinceLastSaveRef.current;
      const action = decideExternalWrite(snapshot.externalWrite === true, pendingLocalWork);
      if (action === "prompt") {
        const text = await loadCollabText(urls.documentUrl, authToken);
        refs.externalWriteSeenRef.current = text.etag ?? null;
        refs.externalWriteHoldRef.current = true;
        urls.onExternalWrite?.({ markdown: text.markdown, title: text.title });
        return false;
      }
      if (action === "rebuild") {
        const text = await loadCollabText(urls.documentUrl, authToken);
        refs.externalWriteSeenRef.current = text.etag ?? null;
        replaceDocumentWithExternalText(ydoc, text.markdown, text.title, documentFormat);
        refs.markdownOverrideRef.current = text.markdown;
        refs.externalWriteHoldRef.current = false;
        refs.localDirtySinceLastSaveRef.current = true;
        refs.lastSuccessfulSaveSignatureRef.current = null;
        await updatePendingState(true, false);
        setSnapshotPreview(null);
        return true;
      }

      Y.applyUpdate(ydoc, snapshot.update, SERVER_ORIGIN);
      setSnapshotPreview(null);
      return true;
    },
    [documentFormat, refs, room, updatePendingState, urls],
  );

  const applyServerBootstrap = useCallback(
    async (generation: number, authToken: string | undefined) => {
      const ydoc = refs.ydocRef.current;
      if (!ydoc || !isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;

      let loadedTitle: string | null = null;
      let loadedEtag: string | null = null;
      const load = await loadBootstrapInParallel({
        loadMarkdown: async () => {
          const text = await loadCollabText(urls.documentUrl, authToken);
          loadedTitle = text.title;
          loadedEtag = text.etag ?? null;
          return text.markdown;
        },
        fetchSnapshot: () => fetchYjsSnapshot(urls.yjsUrl, authToken),
        // Teardown drops the doc it is loading into; stop retrying then.
        isCurrent: () =>
          isJoinGenerationCurrent(generation, refs.joinGenerationRef) &&
          refs.ydocRef.current === ydoc,
        onAttemptFailed: () => markRoomServerFailure(room),
      });
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;

      if (load.markdownError) {
        // A stale text read is not a choice screen. The snapshot still merges.
        console.warn("[docs-collab] markdown load failed", load.markdownError);
      }

      const snapshot = load.snapshot;
      // C7: the snapshot state is unknown, so seeding would risk a second copy.
      // The room is already in backoff via onAttemptFailed; the reconnect path
      // retries the sidecar once that backoff allows it. Markdown stays a
      // read-only preview and is not written into the Y.Doc.
      if (snapshot.kind === "failed" && isCollabDocumentGoneError(snapshot.error)) {
        urls.onDocumentGone?.();
        refs.saveTerminalKindRef.current = "gone";
        refs.saveRetryMsRef.current = Number.POSITIVE_INFINITY;
        refs.nextSaveAttemptAtRef.current = Number.POSITIVE_INFINITY;
        setDocStatus(DOC_STATUS_DOCUMENT_GONE);
        return;
      }

      if (snapshot.kind === "failed") {
        console.warn("[docs-collab] yjs load failed", snapshot.error);
        const markdown = load.markdown;
        refs.lastKnownMarkdownRef.current = markdown;
        refs.pendingMarkdownRef.current = "";
        setSnapshotPreview(markdown.trim() ? markdown : null);
        setDocStatus(DOC_STATUS_SNAPSHOT_UNAVAILABLE);
        return;
      }

      let settlement: "adopted" | "rebuilt" | "prompted" | "other" = "other";
      if (snapshot.kind === "snapshot") {
        const pendingLocalWork =
          refs.pendingServerSaveRef.current || refs.localDirtySinceLastSaveRef.current;
        const action = decideExternalWrite(snapshot.externalWrite, pendingLocalWork);
        rememberSidecarEtag(room, snapshot.etag);
        if (action !== "adopt") refs.externalWriteSeenRef.current = loadedEtag;
        if (action === "prompt") {
          refs.externalWriteHoldRef.current = true;
          urls.onExternalWrite?.({ markdown: load.markdown, title: loadedTitle });
          settlement = "prompted";
        } else if (action === "rebuild") {
          replaceDocumentWithExternalText(ydoc, load.markdown, loadedTitle, documentFormat);
          refs.markdownOverrideRef.current = load.markdown;
          refs.externalWriteHoldRef.current = false;
          refs.seedDoneRef.current = true;
          settlement = "rebuilt";
        } else {
          const adoption = decideServerStateAdoption({
            hasServerSnapshot: true,
            pendingServerSave: refs.pendingServerSaveRef.current,
          });
          if (adoption === "adopt-server") {
            adoptServerSnapshot(ydoc, snapshot.update, SERVER_ORIGIN);
          } else {
            Y.applyUpdate(ydoc, snapshot.update, SERVER_ORIGIN);
          }
          if (markSeedDoneAfterSnapshot(ydoc)) {
            refs.seedDoneRef.current = true;
          }
          settlement = "adopted";
        }
      } else if (snapshot.kind === "absent") {
        rememberSidecarEtag(room, null);
      }

      const hadSnapshot = snapshot.kind === "snapshot";
      const markdown = load.markdown;
      if (hadSnapshot || markdown) {
        markRoomServerSuccess(room);
      }

      const seed = resolveBootstrapSeed(markdown, refs.seedContentRef.current);
      // The prompt keeps the local document. Queueing the server markdown
      // would let a later mesh seed replace that document.
      refs.pendingMarkdownRef.current = settlement === "prompted" ? "" : seed;
      refs.lastKnownMarkdownRef.current = settlement === "prompted" ? "" : markdown;
      if (settlement === "rebuilt") {
        refs.localDirtySinceLastSaveRef.current = true;
        refs.lastSuccessfulSaveSignatureRef.current = null;
        await updatePendingState(true, false);
      } else if (settlement !== "prompted") {
        refs.lastSuccessfulSaveSignatureRef.current = docSignature(markdown, ydoc);
        refs.localDirtySinceLastSaveRef.current = false;
      }

      if (settlement !== "prompted" && !refs.seedDoneRef.current && isYDocEmpty(ydoc)) {
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
      } else if (settlement === "rebuilt") {
        setDocStatus(DOC_STATUS_LOADED_SHARED_DOCUMENT);
      } else if (hadSnapshot && settlement === "adopted") {
        setDocStatus(DOC_STATUS_RESTORED_WORKING_VERSION);
      }

      flushMeshSyncIfHydrated();
    },
    [
      documentFormat,
      flushMeshSyncIfHydrated,
      markDocReady,
      refs,
      updatePendingState,
      room,
      setDocStatus,
      trySeedFromFile,
      urls,
    ],
  );

  const connectMeshInBackground = useCallback(
    async (generation: number, name: string, authToken: string) => {
      if (refs.meshRef.current || meshJoinInFlightRef.current) return;
      const token = {};
      meshJoinInFlightRef.current = token;
      const isCurrent = () => isJoinGenerationCurrent(generation, refs.joinGenerationRef);
      setDocStatus((prev) => prev || "Connecting to collaborators…");
      setStatus(docsLabels.statusConnecting);
      try {
        const meshPeers = await joinMesh(name, authToken, isCurrent);
        if (meshPeers === null || !isCurrent()) return;
        setConnectingPeers(meshPeers);
        refreshMeshUi();
        setDocStatus((prev) => (prev === "Connecting to collaborators…" ? "" : prev));
        trySeedFromFile();
      } catch (error) {
        if (!isCurrent()) return;
        markRoomServerFailure(room);
        console.warn("[docs-collab] mesh join failed", error);
        setDocStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (meshJoinInFlightRef.current === token) meshJoinInFlightRef.current = null;
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

  const finishAuthenticatedJoin = useCallback(
    async (generation: number, name: string, authToken: string) => {
      if (serverJoinStartedRef.current && refs.authTokenRef.current === authToken) return;
      serverJoinStartedRef.current = true;
      refs.authTokenRef.current = authToken;
      await applyServerBootstrap(generation, authToken);
      if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) return;
      if (refs.tabSyncRef.current?.isMeshLeader()) {
        await connectMeshInBackground(generation, name, authToken);
      }
      flushPendingSaveIfReady();
    },
    [applyServerBootstrap, connectMeshInBackground, flushPendingSaveIfReady, refs],
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
    const database = await resolveDocsCollabDatabase(room);
    if (!isJoinGenerationCurrent(generation, refs.joinGenerationRef)) {
      if (refs.ydocRef.current === ydoc) refs.ydocRef.current = null;
      ydoc.destroy();
      return;
    }
    const persistence = new IndexeddbPersistence(database.name, ydoc);
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

    await migrateDocsCollabPendingSaveFromLegacy(
      room,
      persistence,
      database.nodeId ? docsCollabPathKeyedSources(room) : undefined,
    );

    const pendingSave = await persistence.get(PENDING_SERVER_SAVE_KEY);
    if (pendingSave) {
      await updatePendingState(true, false);
    }

    const awareness = new awarenessProtocol.Awareness(ydoc);
    refs.awarenessRef.current = awareness;
    const user = { name, color: colorForName(name), id: trackChangesAuthorIdFromName(name) };
    awareness.setLocalStateField("user", user);

    setSession({
      ydoc,
      awareness,
      user,
    });

    ydoc.on("update", (update, origin) => {
      if (isRemoteUpdateOrigin(origin, refs.persistenceRef.current)) return;
      refs.localDirtySinceLastSaveRef.current = true;
      const encoded = encodeUpdateBroadcast(update);
      const tabSync = refs.tabSyncRef.current;
      const mayMeshPublish = mayPublishDocumentBearingMeshSync(ydoc, refs.seedDoneRef.current);
      if (tabSync) {
        tabSync.onLocalSync(encoded);
        if (tabSync.isMeshLeader() && mayMeshPublish) {
          refs.meshRef.current?.noteLocalUpdate(update);
        }
        return;
      }
      if (!mayMeshPublish) return;
      refs.meshRef.current?.noteLocalUpdate(update);
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

    refs.joinedRoomRef.current = room;
    setJoined(true);

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

    setDocStatus("Loading document…");

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
      if (!authToken) {
        // Token may still be hydrating (docs-app race). Do not GET/PUT
        // unauthenticated or skip mesh forever — finishAuthenticatedJoin
        // runs when urls.authToken arrives.
        return;
      }
      await finishAuthenticatedJoin(generation, name, authToken);
    })();
  }, [
    documentFormat,
    finishAuthenticatedJoin,
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

  useEffect(() => {
    if (!joined) return;
    const token = urls.authToken?.trim();
    if (!token) return;
    if (serverJoinStartedRef.current) return;
    if (refs.joinedRoomRef.current !== room) return;
    if (!getConnectivitySnapshot() || !roomServerAllowed(room)) return;
    const name = userName.trim();
    if (!name) return;
    const generation = refs.joinGenerationRef.current;
    void finishAuthenticatedJoin(generation, name, token).catch((error) => {
      console.warn("[docs-collab] delayed auth join failed", error);
    });
  }, [finishAuthenticatedJoin, joined, refs, room, urls.authToken, userName]);

  return {
    session,
    joined,
    snapshotPreview,
    join,
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
