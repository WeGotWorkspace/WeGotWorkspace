import { useCallback, useState } from "react";
import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { resumeDocsCollabMeshSession } from "./docs-collab-mesh-linger";
import { applyAwarenessUpdate, encodeSyncStep1, handleSyncMessage } from "./docs-collab-mesh-sync";
import type { TabMeshStateSnapshot } from "./docs-collab-tab-sync";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";
import { DocsRtcSession } from "./docs-rtc-session";
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabSessionRefs,
  DocsCollabUrls,
} from "./docs-collab-types";
import { isYDocEmpty, MESH_ORIGIN } from "./docs-collab-utils";

export const PEER_FAILURE_WARNING_DELAY_MS = 6000;

type UseDocsCollabMeshOptions = {
  refs: DocsCollabSessionRefs;
  room: string;
  urls: DocsCollabUrls;
  markDocReady: () => void;
  trySeedFromFile: () => void;
};

export function useDocsCollabMesh({
  refs,
  room,
  urls,
  markDocReady,
  trySeedFromFile,
}: UseDocsCollabMeshOptions) {
  const [peers, setPeers] = useState<DocsCollabMeshPeer[]>([]);
  const [connectingPeers, setConnectingPeers] = useState<DocsCollabMeshPeer[]>([]);
  const [warningPeers, setWarningPeers] = useState<DocsCollabMeshPeer[]>([]);
  const [linkCount, setLinkCount] = useState(0);
  const [status, setStatus] = useState("Disconnected");

  const resetMeshUi = useCallback(() => {
    setPeers([]);
    setConnectingPeers([]);
    setWarningPeers([]);
    refs.failedSinceRef.current.clear();
    setLinkCount(0);
    setStatus("Disconnected");
  }, [refs]);

  const buildMeshStateSnapshot = useCallback((): TabMeshStateSnapshot | null => {
    const mesh = refs.meshRef.current;
    if (!mesh) return null;
    const roomPeerStatuses = mesh.getRoomPeerStatuses();
    const connectedPeers = roomPeerStatuses
      .filter((peer) => peer.link === "connected")
      .map(({ id, name }) => ({ id, name }));
    const pendingPeers = roomPeerStatuses
      .filter((peer) => peer.link !== "connected")
      .map(({ id, name }) => ({ id, name }));
    const now = Date.now();
    const warning: DocsCollabMeshPeer[] = [];
    for (const peer of roomPeerStatuses) {
      if (peer.link === "failed" || peer.link === "disconnected" || peer.link === "closed") {
        const failedSince = refs.failedSinceRef.current.get(peer.id) ?? now;
        if (now - failedSince >= PEER_FAILURE_WARNING_DELAY_MS) {
          warning.push({ id: peer.id, name: peer.name });
        }
      }
    }
    return {
      peers: connectedPeers,
      connectingPeers: pendingPeers,
      warningPeers: warning,
      linkCount: mesh.linkCount(),
      status: `Mesh · ${mesh.getMyName()} · ${mesh.getMyId()?.slice(0, 8) ?? "—"}… · ${roomPeerStatuses.length} peer(s) in room · ${mesh.linkCount()} link(s)`,
    };
  }, [refs]);

  const publishMeshStateToTabs = useCallback(() => {
    const tabSync = refs.tabSyncRef.current;
    if (!tabSync?.isMeshLeader()) return;
    const state = buildMeshStateSnapshot();
    if (state) tabSync.publishMeshState(state);
  }, [buildMeshStateSnapshot, refs]);

  const applyRelayedMeshState = useCallback(
    (state: TabMeshStateSnapshot) => {
      if (refs.tabSyncRef.current?.isMeshLeader()) return;
      setLinkCount(state.linkCount);
      setPeers(state.peers);
      setConnectingPeers(state.connectingPeers);
      setWarningPeers(state.warningPeers);
      setStatus(state.status);
    },
    [refs],
  );

  const leaveMeshAsFollower = useCallback(async () => {
    const meshSession = refs.meshRef.current;
    refs.meshRef.current = null;
    if (meshSession) await meshSession.leave();
    resetMeshUi();
  }, [refs, resetMeshUi]);

  const refreshMeshUi = useCallback(() => {
    const mesh = refs.meshRef.current;
    if (!mesh) return;
    const roomPeerStatuses = mesh.getRoomPeerStatuses();
    const connectedPeers = roomPeerStatuses
      .filter((peer) => peer.link === "connected")
      .map(({ id, name }) => ({ id, name }));
    const pendingPeers = roomPeerStatuses
      .filter((peer) => peer.link !== "connected")
      .map(({ id, name }) => ({ id, name }));
    const now = Date.now();
    const failedNow = new Set<string>();
    const warning: DocsCollabMeshPeer[] = [];
    for (const peer of roomPeerStatuses) {
      if (peer.link === "failed" || peer.link === "disconnected" || peer.link === "closed") {
        failedNow.add(peer.id);
        const failedSince = refs.failedSinceRef.current.get(peer.id) ?? now;
        refs.failedSinceRef.current.set(peer.id, failedSince);
        if (now - failedSince >= PEER_FAILURE_WARNING_DELAY_MS) {
          warning.push({ id: peer.id, name: peer.name });
        }
      } else {
        refs.failedSinceRef.current.delete(peer.id);
      }
    }
    for (const trackedId of [...refs.failedSinceRef.current.keys()]) {
      if (!failedNow.has(trackedId) && !roomPeerStatuses.some((peer) => peer.id === trackedId)) {
        refs.failedSinceRef.current.delete(trackedId);
      }
    }
    setLinkCount(mesh.linkCount());
    setPeers(connectedPeers);
    setConnectingPeers(pendingPeers);
    setWarningPeers(warning);
    setStatus(
      `Mesh · ${mesh.getMyName()} · ${mesh.getMyId()?.slice(0, 8) ?? "—"}… · ${roomPeerStatuses.length} peer(s) in room · ${mesh.linkCount()} link(s)`,
    );
  }, [refs]);

  const sendSyncStep1 = useCallback(
    (toPeerId?: string) => {
      const ydoc = refs.ydocRef.current;
      const mesh = refs.meshRef.current;
      if (!ydoc || !mesh) return;
      const msg = { type: "sync" as const, u: encodeSyncStep1(ydoc) };
      if (toPeerId) mesh.sendTo(toPeerId, msg);
      else mesh.broadcast(msg);
    },
    [refs],
  );

  const handleMeshMessage = useCallback(
    (msg: DocsCollabMeshMessage) => {
      const ydoc = refs.ydocRef.current;
      const awareness = refs.awarenessRef.current;
      if (!ydoc || !awareness) return;

      if (msg.type === "sync" && Array.isArray(msg.u)) {
        const reply = handleSyncMessage(msg.u, ydoc, MESH_ORIGIN);
        if (!isYDocEmpty(ydoc)) markDocReady();
        if (reply) {
          if (msg.from) refs.meshRef.current?.sendTo(msg.from, reply);
          else refs.meshRef.current?.broadcast(reply);
        }
      }
      if (msg.type === "awareness" && Array.isArray(msg.u)) {
        applyAwarenessUpdate(msg.u, awareness, MESH_ORIGIN);
      }
      if (msg.type === "dc-open" && msg.from) {
        sendSyncStep1(msg.from);
        trySeedFromFile();
      }
      refs.tabSyncRef.current?.relayMeshMessage(msg);
      refreshMeshUi();
      publishMeshStateToTabs();
    },
    [markDocReady, publishMeshStateToTabs, refs, refreshMeshUi, sendSyncStep1, trySeedFromFile],
  );

  const joinMesh = useCallback(
    async (name: string, authToken: string): Promise<DocsCollabMeshPeer[]> => {
      const resumed = resumeDocsCollabMeshSession(room);
      if (resumed) {
        refs.meshRef.current = resumed;
        resumed.onMessage(handleMeshMessage);
        refreshMeshUi();
        publishMeshStateToTabs();
        // Data channels are already open, so no dc-open will fire — ask the
        // connected peers for their state against the freshly loaded Y.Doc.
        sendSyncStep1();
        return resumed.getRoomPeers();
      }

      let rtcSettings;
      try {
        rtcSettings = await refs.wireRef.current.fetchRtcSettings({
          url: urls.collabRtcUrl,
          bearerToken: authToken,
          channel: "collab",
        });
      } catch (error) {
        console.warn("[docs-collab] rtc settings unavailable", error);
        rtcSettings = await DEFAULT_DOCS_COLLAB_WIRE.fetchRtcSettings({ channel: "collab" });
      }

      const mesh = new DocsRtcSession({
        apiBase: urls.collabApiBaseUrl ?? "/api/v1/rooms",
        room,
        authToken,
        rtcSettings:
          rtcSettings ?? applyRtcDebugOverrides({ ...DEFAULT_RTC_SETTINGS, forceRelay: false }),
      });
      refs.meshRef.current = mesh;
      mesh.onMessage(handleMeshMessage);
      const joinedData = await mesh.join(name);
      refreshMeshUi();
      publishMeshStateToTabs();
      return joinedData.peers;
    },
    [
      handleMeshMessage,
      publishMeshStateToTabs,
      refs,
      refreshMeshUi,
      room,
      sendSyncStep1,
      urls.collabApiBaseUrl,
      urls.collabRtcUrl,
    ],
  );

  return {
    peers,
    connectingPeers,
    warningPeers,
    linkCount,
    status,
    setStatus,
    setConnectingPeers,
    refreshMeshUi,
    sendSyncStep1,
    handleMeshMessage,
    joinMesh,
    resetMeshUi,
    leaveMeshAsFollower,
    applyRelayedMeshState,
    publishMeshStateToTabs,
  };
}
