import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { DocsCollabSessionRefs, DocsCollabTabSyncApi } from "./docs-collab-types";
import { applyAwarenessUpdate, handleSyncMessage } from "./docs-collab-mesh-sync";
import {
  BC_TAB_ORIGIN,
  DocsCollabTabCoordinator,
  type TabMeshStateSnapshot,
  type TabSyncHandlers,
} from "./docs-collab-tab-sync";
import { isYDocEmpty } from "./docs-collab-utils";

type MeshApi = Pick<
  ReturnType<typeof import("./use-docs-collab-mesh").useDocsCollabMesh>,
  "joinMesh" | "leaveMeshAsFollower" | "applyRelayedMeshState" | "publishMeshStateToTabs"
>;

type JoinApi = Pick<
  ReturnType<typeof import("./use-docs-collab-join").useDocsCollabJoin>,
  "connectMeshInBackground" | "markDocReady" | "trySeedFromFile"
>;

type UseDocsCollabTabSyncOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  userName: string;
  joined: boolean;
  mesh: MeshApi;
  join: JoinApi;
  tabSyncRef: MutableRefObject<DocsCollabTabSyncApi | null>;
};

export type { DocsCollabTabSyncApi };

export function useDocsCollabTabSync({
  refs,
  room,
  userName,
  joined,
  mesh,
  join,
  tabSyncRef,
}: UseDocsCollabTabSyncOptions) {
  const coordinatorRef = useRef<DocsCollabTabCoordinator | null>(null);
  const meshRef = useRef(mesh);
  const joinRef = useRef(join);
  meshRef.current = mesh;
  joinRef.current = join;

  const tryConnectMeshAsLeader = useCallback(async () => {
    const authToken = refs.authTokenRef.current;
    const generation = refs.joinGenerationRef.current;
    const name = userName.trim();
    if (!authToken || !name) return;
    await joinRef.current.connectMeshInBackground(generation, name, authToken);
  }, [refs, userName]);

  const leaveMeshAsFollower = useCallback(async () => {
    await meshRef.current.leaveMeshAsFollower();
  }, []);

  useEffect(() => {
    if (!joined) {
      coordinatorRef.current?.stop();
      coordinatorRef.current = null;
      tabSyncRef.current = null;
      return;
    }

    const ydoc = refs.ydocRef.current;
    const awareness = refs.awarenessRef.current;
    if (!ydoc || !awareness) return;

    const handlers: TabSyncHandlers = {
      onSyncFromTab: (updateBytes) => {
        handleSyncMessage(updateBytes, ydoc, BC_TAB_ORIGIN);
        if (!isYDocEmpty(ydoc)) joinRef.current.markDocReady();
      },
      onAwarenessFromTab: (updateBytes) => {
        applyAwarenessUpdate(updateBytes, awareness, BC_TAB_ORIGIN);
      },
      onMeshStateFromLeader: (state: TabMeshStateSnapshot) => {
        meshRef.current.applyRelayedMeshState(state);
      },
      onBecomeLeader: () => {
        void tryConnectMeshAsLeader();
      },
      onResignLeader: () => {
        void leaveMeshAsFollower();
      },
    };

    const coordinator = new DocsCollabTabCoordinator(room, handlers);
    coordinatorRef.current = coordinator;
    coordinator.start();
    if (coordinator.meshLeader) {
      void tryConnectMeshAsLeader();
    }

    tabSyncRef.current = {
      onLocalSync: (encoded) => {
        coordinator.publishSync(encoded);
        if (coordinator.meshLeader) {
          refs.meshRef.current?.broadcast({ type: "sync", u: encoded });
        }
      },
      onLocalAwareness: (encoded) => {
        coordinator.publishAwareness(encoded);
        if (coordinator.meshLeader) {
          refs.meshRef.current?.broadcast({ type: "awareness", u: encoded });
        }
      },
      relayMeshMessage: (msg) => {
        coordinator.relayMeshMessage(msg);
      },
      publishMeshState: (state) => {
        coordinator.publishMeshState(state);
      },
      isMeshLeader: () => coordinator.meshLeader,
    };

    return () => {
      coordinator.stop();
      coordinatorRef.current = null;
      tabSyncRef.current = null;
    };
  }, [joined, leaveMeshAsFollower, refs, room, tabSyncRef, tryConnectMeshAsLeader]);
}
