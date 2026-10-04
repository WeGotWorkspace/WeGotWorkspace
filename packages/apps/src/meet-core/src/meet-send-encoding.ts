import {
  applyPeerVideoSenders,
  cameraMaxProfileIsAudio,
  effectiveSendProfile,
  selectedPairIsRelay,
  DEFAULT_VIDEO_LIMITS,
  type ScreenOptimize,
  type VideoLimits,
} from "@/meet-core/src/meet-video-sender";

export type MeetEncodingPrefs = {
  lowData: boolean;
  screenMode: ScreenOptimize;
  screenTrackId: string | null;
};

export const DEFAULT_ENCODING_PREFS: MeetEncodingPrefs = {
  lowData: false,
  screenMode: "text",
  screenTrackId: null,
};

/**
 * `setParameters` on every video sender. No offer: the profile change stays on
 * the existing peer connection, including after a relay pair is selected.
 */
export async function applyMeetSendEncodings(
  connections: readonly RTCPeerConnection[],
  remotePeers: number,
  limits: VideoLimits,
  prefs: MeetEncodingPrefs,
): Promise<void> {
  await Promise.all(
    connections.map(async (pc) => {
      let relayed = false;
      try {
        relayed = await selectedPairIsRelay(pc);
      } catch {
        relayed = false;
      }
      const profile = effectiveSendProfile({
        remotePeers,
        limits,
        relayed,
        lowData: prefs.lowData,
      });
      await applyPeerVideoSenders(pc, {
        profile,
        screenMode: prefs.screenMode,
        lowData: prefs.lowData,
        screenTrackId: prefs.screenTrackId,
      });
    }),
  );
}

export function cameraSendingDisabled(limits: VideoLimits | null | undefined): boolean {
  return cameraMaxProfileIsAudio(limits ?? DEFAULT_VIDEO_LIMITS);
}
