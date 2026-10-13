import { useEffect, useMemo, useState } from "react";
import {
  createRtcSession,
  type CreateRtcSessionOptions,
  type CreateRtcSessionSignalingOptions,
} from "@/lib/rtc/session/create-rtc-session";
import type { RtcSignalingAuth } from "@/lib/rtc/signaling/create-client";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { RtcLinkState, RtcPeerDescriptor } from "@/lib/rtc/types";

export type UseRtcSessionOptions = Omit<CreateRtcSessionOptions, "signaling"> & {
  apiBase: string;
  enabled?: boolean;
  auth?: RtcSignalingAuth;
  signaling?: CreateRtcSessionSignalingOptions;
};

export type UseRtcSessionResult = {
  mesh: RtcPeerMesh | null;
  peerId: string | null;
  peers: RtcPeerDescriptor[];
  linkStates: Array<RtcPeerDescriptor & { link: RtcLinkState }>;
  join: (input: { name: string; peerId?: string }) => Promise<void>;
  leave: () => Promise<void>;
};

export function useRtcSession(options: UseRtcSessionOptions): UseRtcSessionResult {
  const { apiBase, enabled = true, auth, signaling, ...sessionOptions } = options;
  const mesh = useMemo(() => {
    if (!enabled) return null;
    return createRtcSession({
      ...sessionOptions,
      signaling: {
        apiBase,
        getAuth: () => auth ?? {},
        ...signaling,
      },
      onLinkChange: () => {
        sessionOptions.onLinkChange?.();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mesh is scoped to channel/room/apiBase
  }, [enabled, apiBase, sessionOptions.channel, sessionOptions.room]);

  const [peerId, setPeerId] = useState<string | null>(null);
  const [peers, setPeers] = useState<RtcPeerDescriptor[]>([]);
  const [linkStates, setLinkStates] = useState<Array<RtcPeerDescriptor & { link: RtcLinkState }>>(
    [],
  );

  useEffect(() => {
    return () => {
      void mesh?.leave();
    };
  }, [mesh]);

  const refresh = () => {
    if (!mesh) return;
    setPeerId(mesh.getMyId());
    setPeers(mesh.getRoomPeers());
    setLinkStates(mesh.getPeerLinkStates());
  };

  return {
    mesh,
    peerId,
    peers,
    linkStates,
    join: async (input) => {
      if (!mesh) throw new Error("RTC session is not initialized");
      const joined = await mesh.join(input);
      if (joined.superseded) return;
      setPeerId(joined.peerId);
      refresh();
    },
    leave: async () => {
      if (!mesh) return;
      await mesh.leave();
      setPeerId(null);
      setPeers([]);
      setLinkStates([]);
    },
  };
}
