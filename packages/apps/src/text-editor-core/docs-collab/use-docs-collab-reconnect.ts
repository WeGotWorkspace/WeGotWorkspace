import { useCallback } from "react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useOnReconnect } from "@/hooks/use-connectivity";
import {
  wgwAwaitSessionRefreshForReconnect,
  wgwEnsureFreshAccessToken,
  wgwHasAuthenticatedSession,
} from "@/lib/api/wgw/http";
import { isFetchNetworkError } from "@/lib/offline/browser-online";
import { isReconnectGenerationCurrent } from "./docs-collab-join-lifecycle";
import {
  markRoomServerFailure,
  markRoomServerSuccess,
  roomServerAllowed,
} from "./docs-collab-room-backoff";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";
import { PENDING_SERVER_SAVE_KEY } from "./use-docs-collab-save";

type MeshApi = Pick<
  ReturnType<typeof import("./use-docs-collab-mesh").useDocsCollabMesh>,
  "joinMesh" | "refreshMeshUi" | "setStatus" | "setConnectingPeers"
>;

type SaveApi = Pick<
  ReturnType<typeof import("./use-docs-collab-save").useDocsCollabSave>,
  "persistToServer" | "flushPendingSaveIfReady"
>;

type JoinApi = Pick<
  ReturnType<typeof import("./use-docs-collab-join").useDocsCollabJoin>,
  "trySeedFromFile" | "mergeServerState"
>;

type UseDocsCollabReconnectOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  urls: DocsCollabUrls;
  userName: string;
  joined: boolean;
  mesh: MeshApi;
  save: SaveApi;
  join: JoinApi;
  setDocStatus: (status: string | ((prev: string) => string)) => void;
};

export function useDocsCollabReconnect({
  refs,
  room,
  urls,
  userName,
  joined,
  mesh,
  save,
  join,
  setDocStatus,
}: UseDocsCollabReconnectOptions) {
  const { joinMesh, refreshMeshUi, setStatus, setConnectingPeers } = mesh;
  const { persistToServer, flushPendingSaveIfReady } = save;
  const { trySeedFromFile, mergeServerState } = join;

  const resolveAuthTokenForReconnect = useCallback(async (): Promise<string | undefined> => {
    refs.authTokenRef.current = undefined;
    try {
      if (wgwHasAuthenticatedSession()) {
        await wgwAwaitSessionRefreshForReconnect();
        try {
          const freshToken = await wgwEnsureFreshAccessToken();
          if (freshToken?.trim()) {
            refs.authTokenRef.current = freshToken;
            return freshToken;
          }
        } catch {
          // Fall back to wire auth when WGW session refresh is unavailable.
        }
      }
      const token = await refs.wireRef.current.fetchAuthToken({
        authToken: urls.authToken,
        authTokenUrl: urls.authTokenUrl,
        authUser: urls.authUser,
        authPassword: urls.authPassword,
      });
      refs.authTokenRef.current = token;
      return token;
    } catch (error) {
      markRoomServerFailure(room);
      if (!isFetchNetworkError(error)) {
        console.warn("[docs-collab] auth unavailable on reconnect", error);
      }
      return undefined;
    }
  }, [refs, room, urls.authPassword, urls.authToken, urls.authTokenUrl, urls.authUser]);

  const restartMeshAfterReconnect = useCallback(
    async (generation: number, authToken: string): Promise<void> => {
      const tabSync = refs.tabSyncRef.current;
      if (tabSync && !tabSync.isMeshLeader()) return;
      const name = userName.trim();
      if (!name) return;

      const existingMesh = refs.meshRef.current;
      refs.meshRef.current = null;
      if (existingMesh) await existingMesh.leave();
      if (!isReconnectGenerationCurrent(generation, refs.reconnectGenerationRef)) return;

      setStatus(docsLabels.statusConnecting);
      const meshPeers = await joinMesh(name, authToken);
      if (!isReconnectGenerationCurrent(generation, refs.reconnectGenerationRef)) return;
      setConnectingPeers(meshPeers);
      refreshMeshUi();
      trySeedFromFile();
    },
    [joinMesh, refs, refreshMeshUi, setConnectingPeers, setStatus, trySeedFromFile, userName],
  );

  const handleReconnect = useCallback(async () => {
    if (refs.reconnectInFlightRef.current) return;
    const generation = ++refs.reconnectGenerationRef.current;
    const ydoc = refs.ydocRef.current;
    const persistence = refs.persistenceRef.current;
    if (!ydoc || !persistence || !joined) return;
    refs.reconnectInFlightRef.current = true;

    setDocStatus("Reconnecting…");
    const allowServerRequests = roomServerAllowed(room);

    try {
      const authToken = await resolveAuthTokenForReconnect();
      if (!isReconnectGenerationCurrent(generation, refs.reconnectGenerationRef)) return;

      if (authToken) {
        await restartMeshAfterReconnect(generation, authToken);
        if (!isReconnectGenerationCurrent(generation, refs.reconnectGenerationRef)) return;
      }

      if (allowServerRequests) {
        await mergeServerState(authToken);
        markRoomServerSuccess(room);
        if (!isReconnectGenerationCurrent(generation, refs.reconnectGenerationRef)) return;

        const pendingSave = await persistence.get(PENDING_SERVER_SAVE_KEY);
        if (pendingSave || refs.pendingServerSaveRef.current) {
          await persistToServer();
        } else {
          refs.localDirtySinceLastSaveRef.current = false;
          setDocStatus((prev) => (prev === "Reconnecting…" ? "" : prev));
        }
        flushPendingSaveIfReady();
      } else {
        setDocStatus((prev) => (prev === "Reconnecting…" ? "" : prev));
      }
    } catch (error) {
      markRoomServerFailure(room);
      console.warn("[docs-collab] reconnect failed", error);
      setDocStatus(error instanceof Error ? error.message : String(error));
    } finally {
      refs.reconnectInFlightRef.current = false;
    }
  }, [
    flushPendingSaveIfReady,
    joined,
    mergeServerState,
    persistToServer,
    refs,
    resolveAuthTokenForReconnect,
    restartMeshAfterReconnect,
    room,
    setDocStatus,
  ]);

  useOnReconnect(() => {
    if (refs.sessionRef.current) void handleReconnect();
  });

  return { handleReconnect };
}
