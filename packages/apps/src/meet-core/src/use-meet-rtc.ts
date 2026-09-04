import { useCallback, useMemo, useRef } from "react";
import type { HttpSignalingFetch, HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";
import type { RtcPeerDescriptor, RtcSettings } from "@/lib/rtc/types";
import { MeetRtcSession } from "@/meet-core/src/meet-rtc-session";

export type UseMeetRtcOptions = {
  rtcSettings: RtcSettings;
  signalingFetch?: HttpSignalingFetch;
  getLocalStream: () => MediaStream | null;
  onLinkChange: () => void;
  onPollData: (data: HttpSignalingPollResult) => void | Promise<void>;
  shouldConnectToPeer: (peer: RtcPeerDescriptor) => boolean;
  shouldHandleRtcSignals: () => boolean;
  onPeerRemoved: (remoteId: string, name: string, reason: "bye" | "roster") => void;
  onConnectionFailed: (remoteId: string, name: string) => void;
  onPollError: (error: unknown) => void;
  onPeerConnected: (remoteId: string) => void;
  /**
   * Suite-level session holder (from `MeetCallStore`). When provided, the RTC
   * session survives route unmounts instead of living in a per-mount ref.
   */
  persistentSessionRef?: { current: MeetRtcSession | null };
};

function createSession(options: UseMeetRtcOptions): MeetRtcSession {
  return new MeetRtcSession({
    rtcSettings: options.rtcSettings,
    fetchImpl: options.signalingFetch,
    getLocalStream: options.getLocalStream,
    onLinkChange: options.onLinkChange,
    onPollData: options.onPollData,
    shouldConnectToPeer: options.shouldConnectToPeer,
    shouldHandleRtcSignals: options.shouldHandleRtcSignals,
    onPeerRemoved: options.onPeerRemoved,
    onConnectionFailed: options.onConnectionFailed,
    onPollError: options.onPollError,
    onPeerConnected: options.onPeerConnected,
  });
}

export function useMeetRtc(options: UseMeetRtcOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const localSessionRef = useRef<MeetRtcSession | null>(null);

  const getSessionRef = useCallback(
    () => optionsRef.current.persistentSessionRef ?? localSessionRef,
    [],
  );

  const requireSession = useCallback(() => {
    const session = getSessionRef().current;
    if (!session) {
      throw new Error("Meet RTC session is not active");
    }
    return session;
  }, [getSessionRef]);

  const join = useCallback(
    async (input: { room: string; peerId: string; name: string }) => {
      const sessionRef = getSessionRef();
      if (sessionRef.current) {
        await sessionRef.current.leave({ sendBye: false });
      }
      sessionRef.current = createSession(optionsRef.current);
      return sessionRef.current.join(input);
    },
    [getSessionRef],
  );

  const updateJoinName = useCallback(
    async (name: string) => {
      await requireSession().updateJoinName(name);
    },
    [requireSession],
  );

  const leave = useCallback(
    async (opts?: { sendBye?: boolean }) => {
      const sessionRef = getSessionRef();
      if (!sessionRef.current) return;
      await sessionRef.current.leave(opts);
      sessionRef.current = null;
    },
    [getSessionRef],
  );

  const replaceAudioTrack = useCallback(
    async (track: MediaStreamTrack) => {
      await requireSession().replaceAudioTrack(track);
    },
    [requireSession],
  );

  const replaceVideoTrack = useCallback(
    async (track: MediaStreamTrack) => {
      await requireSession().replaceVideoTrack(track);
    },
    [requireSession],
  );

  const getPeerConnection = useCallback(
    (remoteId: string) => getSessionRef().current?.getPeerConnection(remoteId) ?? null,
    [getSessionRef],
  );

  const getRemoteStream = useCallback(
    (remoteId: string) => getSessionRef().current?.getRemoteStream(remoteId) ?? null,
    [getSessionRef],
  );

  const getPeerIds = useCallback(
    () => getSessionRef().current?.getPeerIds() ?? [],
    [getSessionRef],
  );

  const getMyId = useCallback(() => getSessionRef().current?.getMyId() ?? null, [getSessionRef]);

  const getSessionKey = useCallback(
    () => getSessionRef().current?.getSessionKey() ?? null,
    [getSessionRef],
  );

  return useMemo(
    () => ({
      join,
      updateJoinName,
      leave,
      replaceAudioTrack,
      replaceVideoTrack,
      getPeerConnection,
      getRemoteStream,
      getPeerIds,
      getMyId,
      getSessionKey,
    }),
    [
      getMyId,
      getPeerConnection,
      getPeerIds,
      getRemoteStream,
      getSessionKey,
      join,
      leave,
      replaceAudioTrack,
      replaceVideoTrack,
      updateJoinName,
    ],
  );
}
