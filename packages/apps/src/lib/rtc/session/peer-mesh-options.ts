import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import type { HttpSignalingClient, HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";
import type {
  RtcPeerDescriptor,
  RtcPollIntervals,
  RtcSettings,
  SignalingChannel,
} from "@/lib/rtc/types";

export type InitiatorRule = "lowerId" | "higherId";

export type RtcMeshVisibilityPort = {
  getState: () => DocumentVisibilityState;
  subscribe: (listener: () => void) => () => void;
};

/** Injection seams for tests: peer connections, timers, and tab visibility. */
export type RtcPeerMeshPorts = {
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  visibility?: RtcMeshVisibilityPort;
};

export function defaultVisibilityPort(): RtcMeshVisibilityPort | null {
  if (typeof document === "undefined") return null;
  return {
    getState: () => document.visibilityState,
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export type RtcPeerMeshOptions = {
  channel: SignalingChannel;
  room: string;
  signaling: HttpSignalingClient;
  rtcSettings: RtcSettings;
  binding?: RtcSessionBinding;
  pollIntervals?: RtcPollIntervals;
  iceCandidatePoolSize?: number;
  initiatorRule?: InitiatorRule;
  recoverOnUnknownPeer?: boolean;
  ports?: RtcPeerMeshPorts;
  formatInboundDescription?: (
    payload: unknown,
    fallbackType: RTCSdpType,
  ) => RTCSessionDescriptionInit | null;
  formatOutboundDescription?: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  onLinkChange?: () => void;
  onUnknownPeer?: () => void;
  shouldConnectToPeer?: (peer: RtcPeerDescriptor) => boolean;
  shouldHandleRtcSignals?: () => boolean;
  onPollData?: (data: HttpSignalingPollResult) => void | Promise<void>;
  onPeerRemoved?: (remoteId: string, name: string, reason: "bye" | "roster") => void;
  onConnectionFailed?: (remoteId: string, name: string) => void;
  onPollError?: (error: unknown) => void;
  onPeerConnected?: (remoteId: string) => void;
  /** A data-channel send threw. The caller should resync that peer. */
  onSendFailed?: (remoteId: string) => void;
  /** When false, inbound offers are dropped without creating a peer connection. */
  shouldAcceptOffer?: (from: string) => boolean;
};
