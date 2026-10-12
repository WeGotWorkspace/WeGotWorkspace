import type { NetClass } from "@/lib/rtc/net-probe";
import { resetNetClass } from "@/lib/rtc/net-probe";
import { netClassForJoin } from "@/lib/rtc/net-probe-session";
import { IceOutbound, peerAcceptsIceBatch } from "@/lib/rtc/session/ice-batch";
import { IceRecovery, RECOVERY_TIMEOUT_MS } from "@/lib/rtc/session/ice-recovery";
import type { MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { MeshRelay } from "@/lib/rtc/session/mesh-relay";
import type { RtcPeerMeshOptions } from "@/lib/rtc/session/peer-mesh-options";
import type { RtcPeerDescriptor, RtcSettings } from "@/lib/rtc/types";
import type { RelayRequestClient, RelayRequestOutcome } from "@/lib/rtc/session/relay-request";

/**
 * ICE batching, relay requests, and network-change restart for one mesh.
 * Kept off `RtcPeerMesh` so that file stays under the 800-line ceiling.
 */
export type MeshConnectivityHost = {
  room: string;
  channel: string;
  settings: RtcSettings;
  iceCandidatePoolSize?: number;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
  localPeerId: () => string | null;
  localNet: () => NetClass | undefined;
  setLocalNet: (net: NetClass | undefined) => void;
  roomPeers: () => readonly RtcPeerDescriptor[];
  peerEntry: (remoteId: string) => MeshPeerEntry | undefined;
  peerIds: () => string[];
  peerConnection: (remoteId: string) => RTCPeerConnection | null;
  isInitiator: (remoteId: string) => boolean;
  sendIce: (remoteId: string, payload: unknown) => void;
  sendOffer: (remoteId: string, description: RTCSessionDescription | null) => Promise<void>;
  formatOutbound: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  setTurn: (turn: ReturnType<MeshRelay["credentials"]>) => void;
  relayCredentials: () => ReturnType<MeshRelay["credentials"]>;
  onRelayOutcome?: (remoteId: string, name: string, outcome: RelayRequestOutcome) => void;
  onRelayGiveUp: (remoteId: string, entry: MeshPeerEntry) => void;
  kickPoll: () => void;
  log: (event: string, details?: unknown) => void;
  onIceRestart?: () => void;
  postRelay?: RelayRequestClient["postRelay"];
};

export type MeshConnectivity = {
  iceOut: IceOutbound;
  relay: MeshRelay;
  recovery: IceRecovery;
};

export type MeshSurface = {
  options: RtcPeerMeshOptions;
  scheduleTimeout: typeof setTimeout;
  cancelTimeout: typeof clearTimeout;
  getMyId: () => string | null;
  getLocalNet: () => NetClass | undefined;
  setLocalNet: (net: NetClass | undefined) => void;
  getRoomPeers: () => readonly RtcPeerDescriptor[];
  peerEntry: (remoteId: string) => MeshPeerEntry | undefined;
  peerIds: () => string[];
  peerConnection: (remoteId: string) => RTCPeerConnection | null;
  isInitiator: (remoteId: string) => boolean;
  sendSignal: (to: string, type: string, payload: unknown) => Promise<void>;
  onSignalError: (remoteId: string, error: unknown) => void;
  formatOutbound: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  setTurn: (turn: ReturnType<MeshRelay["credentials"]>) => void;
  restartWithRelay: (remoteId: string, entry: MeshPeerEntry) => Promise<boolean>;
  onGiveUp: (remoteId: string, entry: MeshPeerEntry) => void;
  kickPoll: () => void;
  log: (event: string, details?: unknown) => void;
  sessionKey: () => string | null;
  onIceRestart?: () => void;
};

export function hostFromSurface(surface: MeshSurface): MeshConnectivityHost {
  const relayFn = surface.options.signaling.relay;
  return {
    room: surface.options.room,
    channel: surface.options.channel,
    settings: surface.options.rtcSettings,
    iceCandidatePoolSize: surface.options.iceCandidatePoolSize,
    schedule: surface.scheduleTimeout,
    cancel: surface.cancelTimeout,
    localPeerId: () => surface.getMyId(),
    localNet: () => surface.getLocalNet(),
    setLocalNet: (net) => surface.setLocalNet(net),
    roomPeers: () => surface.getRoomPeers(),
    peerEntry: (remoteId) => surface.peerEntry(remoteId),
    peerIds: () => surface.peerIds(),
    peerConnection: (remoteId) => surface.peerConnection(remoteId),
    isInitiator: (remoteId) => surface.isInitiator(remoteId),
    sendIce: (remoteId, payload) => {
      void surface
        .sendSignal(remoteId, "ice", payload)
        .catch((error) => surface.onSignalError(remoteId, error));
    },
    sendOffer: (remoteId, description) =>
      surface
        .sendSignal(remoteId, "offer", description)
        .catch((error) => surface.onSignalError(remoteId, error)),
    formatOutbound: (description) => surface.formatOutbound(description),
    setTurn: (turn) => surface.setTurn(turn),
    relayCredentials: () => null,
    onRelayOutcome: surface.options.onRelayOutcome,
    onRelayGiveUp: (remoteId, entry) => {
      void surface.restartWithRelay(remoteId, entry).then((retried) => {
        if (!retried) surface.onGiveUp(remoteId, entry);
      });
    },
    kickPoll: () => surface.kickPoll(),
    log: (event, details) => surface.log(event, details),
    onIceRestart: surface.onIceRestart,
    postRelay:
      typeof relayFn === "function"
        ? (roomId, body) =>
            relayFn.call(surface.options.signaling, {
              room: roomId,
              ...body,
              sessionKey: surface.sessionKey() ?? undefined,
            })
        : undefined,
  };
}

export function buildMeshConnectivity(host: MeshConnectivityHost): MeshConnectivity {
  const iceOut = new IceOutbound({
    acceptsBatch: (remoteId) =>
      peerAcceptsIceBatch(host.roomPeers().find((peer) => peer.id === remoteId)?.caps),
    send: (remoteId, payload) => host.sendIce(remoteId, payload),
    schedule: host.schedule,
    cancel: host.cancel,
  });
  const relayBox: { current: MeshRelay | null } = { current: null };
  const recovery = new IceRecovery({
    isInitiator: (remoteId) => host.isInitiator(remoteId),
    remoteNet: (remoteId) => host.roomPeers().find((peer) => peer.id === remoteId)?.net,
    localNet: () => host.localNet(),
    alreadyRequested: (remoteId) => relayBox.current?.hasRequested(remoteId) ?? false,
    markRequested: () => undefined,
    restartIce: (remoteId) => {
      const relay = relayBox.current;
      void (async () => {
        if (relay) await relay.onIceRestart(remoteId);
        await restartPeerIce(host, remoteId);
      })();
    },
    requestRelay: (remoteId, reason) => {
      const relay = relayBox.current;
      if (!relay) return;
      void relay.request(remoteId, reason).then(() => host.setTurn(relay.credentials()));
    },
    resetRelayFallback: (remoteId) => {
      const entry = host.peerEntry(remoteId);
      if (entry) entry.relayFallbackTried = false;
    },
    schedule: host.schedule,
    cancel: host.cancel,
  });
  const forceRelay = host.settings.forceRelay;
  const relay = new MeshRelay({
    enabled: typeof host.postRelay === "function" && (host.channel === "meet" || forceRelay),
    roomId: host.room,
    settings: host.settings,
    forceRelay,
    iceCandidatePoolSize: host.iceCandidatePoolSize,
    localPeerId: () => host.localPeerId(),
    localNet: () => host.localNet(),
    peerName: (remoteId) => host.peerEntry(remoteId)?.name ?? "Peer",
    postRelay: host.postRelay,
    getPeerConnection: (remoteId) => host.peerConnection(remoteId),
    peerIds: () => host.peerIds(),
    onOutcome: (remoteId, name, outcome) => {
      if (outcome.outcome === "issued") host.setTurn(outcome.turn);
      host.onRelayOutcome?.(remoteId, name, outcome);
    },
    onApplied: (remoteId) => {
      host.schedule(() => {
        const entry = host.peerEntry(remoteId);
        if (!entry) return;
        const up =
          entry.pc.connectionState === "connected" ||
          entry.pc.iceConnectionState === "connected" ||
          entry.pc.iceConnectionState === "completed";
        if (!up) host.onRelayGiveUp(remoteId, entry);
      }, RECOVERY_TIMEOUT_MS);
    },
    log: (event, details) => host.log(event, details),
  });
  relayBox.current = relay;
  return { iceOut, relay, recovery };
}

export async function restartPeerIce(host: MeshConnectivityHost, remoteId: string): Promise<void> {
  const entry = host.peerEntry(remoteId);
  if (!entry || typeof entry.pc.restartIce !== "function") return;
  try {
    entry.pc.restartIce();
  } catch {
    return;
  }
  host.onIceRestart?.();
  if (!host.isInitiator(remoteId)) return;
  const offer = await entry.pc.createOffer({ iceRestart: true });
  await entry.pc.setLocalDescription(host.formatOutbound(offer));
  await host.sendOffer(remoteId, entry.pc.localDescription);
}

export function bindNetworkRecovery(host: MeshConnectivityHost, recovery: IceRecovery): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => {
    resetNetClass();
    host.setLocalNet(undefined);
    void netClassForJoin(host.settings).then((net) => host.setLocalNet(net));
    recovery.restartAll(host.peerIds());
    host.kickPoll();
  };
  window.addEventListener("online", onChange);
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    connection?.removeEventListener("change", onChange);
  };
}
