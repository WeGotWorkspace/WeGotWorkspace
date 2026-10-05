import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type * as Y from "yjs";
import type { DocsCollabSessionRefs, DocsCollabTabSyncApi } from "./docs-collab-types";
import {
  applyAwarenessUpdate,
  documentUpdateFromSyncMessage,
  handleSyncMessage,
} from "./docs-collab-mesh-sync";
import {
  BC_TAB_ORIGIN,
  DocsCollabTabCoordinator,
  type TabMeshStateSnapshot,
  type TabSyncHandlers,
} from "./docs-collab-tab-sync";
import { isYDocEmpty } from "./docs-collab-utils";

/**
 * Apply a follower tab's BroadcastChannel sync on this tab. The Yjs listener
 * treats `bc-tab` as remote and returns before the mesh, which is correct for
 * a follower and wrong for the leader: sticky leadership means the typing tab
 * is usually not the one holding the peer connections. The leader re-broadcasts
 * the same sync message and records it for the HTTP fallback, and does not
 * post it back onto the channel.
 */
export function applyFollowerTabSync(input: {
  updateBytes: number[];
  ydoc: Y.Doc;
  meshLeader: boolean;
  broadcast: (message: { type: "sync"; u: number[] }) => void;
  noteLocalUpdate: (update: Uint8Array) => void;
  onDocReady: () => void;
}): void {
  handleSyncMessage(input.updateBytes, input.ydoc, BC_TAB_ORIGIN);
  if (!isYDocEmpty(input.ydoc)) input.onDocReady();
  if (!input.meshLeader) return;
  const update = documentUpdateFromSyncMessage(input.updateBytes);
  if (!update) return;
  input.broadcast({ type: "sync", u: input.updateBytes });
  input.noteLocalUpdate(update);
}

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
        applyFollowerTabSync({
          updateBytes,
          ydoc,
          meshLeader: coordinatorRef.current?.meshLeader ?? false,
          broadcast: (message) => {
            refs.meshRef.current?.broadcast(message);
          },
          noteLocalUpdate: (update) => {
            refs.meshRef.current?.noteLocalUpdate(update);
          },
          onDocReady: () => {
            joinRef.current.markDocReady();
          },
        });
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
