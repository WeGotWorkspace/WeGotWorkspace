import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  isDisplayCaptureSupported,
  isDisplayCaptureUnsupportedError,
  isDisplayCaptureUserCancel,
} from "@/meet-core/src/meet-display-capture";
import { readMeetLowData, subscribeMeetLowData } from "@/meet-core/src/meet-low-data";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  applyScreenOptimize,
  screenCaptureConstraints,
} from "@/meet-core/src/meet-screen-optimize";
import { screenContentHint, type ScreenOptimize } from "@/meet-core/src/meet-video-sender";
import { syncMeetLocalTrackEnabled } from "@/meet-core/src/meet-local-track-enabled";
import {
  buildMeetAudioConstraints,
  buildMeetVideoConstraints,
  meetLocalMediaGumConstraints,
} from "@/meet-core/src/meet-media-constraints";
import type { useMeetRtc } from "@/meet-core/src/use-meet-rtc";
import { useMeetMediaDevices } from "@/meet-core/src/use-meet-media-devices";

type MeetRtc = ReturnType<typeof useMeetRtc>;

/**
 * Suite-level holders (from `MeetCallStore`): local media survives route unmounts
 * when provided; otherwise per-mount refs are used (mock/Storybook behavior).
 */
export type MeetLocalMediaHolders = {
  localStream: { current: MediaStream | null };
  screenStream: { current: MediaStream | null };
  cameraTrack: { current: MediaStreamTrack | null };
  selectedMicId: { current: string | null };
  selectedCamId: { current: string | null };
};

type UseMeetLocalMediaArgs = {
  meetRtc: MeetRtc;
  mediaHolders?: MeetLocalMediaHolders;
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  setMicOn: (value: boolean | ((prev: boolean) => boolean)) => void;
  setVideoOn: (value: boolean | ((prev: boolean) => boolean)) => void;
  setScreenOn: (value: boolean | ((prev: boolean) => boolean)) => void;
  setError: (value: string | null) => void;
  announceMediaPresence: (mic: boolean, camera: boolean, screen?: boolean) => Promise<void>;
  /** Instance ceiling `audio`: the camera must stay off. */
  cameraBlockedRef?: MutableRefObject<boolean>;
  micOnRef: MutableRefObject<boolean>;
  videoOnRef: MutableRefObject<boolean>;
  screenOnRef: MutableRefObject<boolean>;
};

export function useMeetLocalMedia({
  meetRtc,
  mediaHolders,
  micOn,
  videoOn,
  screenOn,
  setMicOn,
  setVideoOn,
  setScreenOn,
  setError,
  announceMediaPresence,
  cameraBlockedRef,
  micOnRef,
  videoOnRef,
  screenOnRef: _screenOnRef,
}: UseMeetLocalMediaArgs) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const fallbackLocalStreamRef = useRef<MediaStream | null>(null);
  const fallbackCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const fallbackScreenStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = mediaHolders?.localStream ?? fallbackLocalStreamRef;
  const cameraTrackRef = mediaHolders?.cameraTrack ?? fallbackCameraTrackRef;
  const screenStreamRef = mediaHolders?.screenStream ?? fallbackScreenStreamRef;
  // Rehydrate mid-call state (e.g. an ongoing screen share) after a route remount.
  const [screenPreviewStream, setScreenPreviewStream] = useState<MediaStream | null>(
    () => screenStreamRef.current,
  );
  const [screenMode, setScreenModeState] = useState<ScreenOptimize>("text");
  const screenModeRef = useRef<ScreenOptimize>("text");
  const { audioInputs, audioOutputs, videoInputs, refreshDeviceList } = useMeetMediaDevices();
  const [selectedMicId, setSelectedMicIdState] = useState<string | null>(
    () => mediaHolders?.selectedMicId.current ?? null,
  );
  const [selectedCamId, setSelectedCamIdState] = useState<string | null>(
    () => mediaHolders?.selectedCamId.current ?? null,
  );

  const selectedMicHolderRef = useRef(mediaHolders?.selectedMicId ?? null);
  const selectedCamHolderRef = useRef(mediaHolders?.selectedCamId ?? null);

  const setSelectedMicId = useCallback((deviceId: string | null) => {
    if (selectedMicHolderRef.current) selectedMicHolderRef.current.current = deviceId;
    setSelectedMicIdState(deviceId);
  }, []);

  const setSelectedCamId = useCallback((deviceId: string | null) => {
    if (selectedCamHolderRef.current) selectedCamHolderRef.current.current = deviceId;
    setSelectedCamIdState(deviceId);
  }, []);

  const replaceAudioTrackOnAllPeers = useCallback(
    async (track: MediaStreamTrack) => {
      await meetRtc.replaceAudioTrack(track);
    },
    [meetRtc],
  );

  const replaceVideoTrackOnAllPeers = useCallback(
    async (track: MediaStreamTrack) => {
      await meetRtc.replaceVideoTrack(track);
    },
    [meetRtc],
  );

  const cameraAllowed = useCallback(() => cameraBlockedRef?.current !== true, [cameraBlockedRef]);

  const ensureLocalMedia = useCallback(async () => {
    const mic = micOnRef.current;
    const video = videoOnRef.current && cameraAllowed();
    if (localStreamRef.current) {
      if (video && localStreamRef.current.getVideoTracks().length === 0) {
        const updated = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildMeetVideoConstraints(selectedCamId ?? undefined),
        });
        const track = updated.getVideoTracks()[0];
        if (track && !localStreamRef.current.getVideoTracks().includes(track)) {
          localStreamRef.current.addTrack(track);
          cameraTrackRef.current = track;
          if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
          await replaceVideoTrackOnAllPeers(track);
        }
      }
      syncMeetLocalTrackEnabled(localStreamRef.current, { mic, video });
      return localStreamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia(
      meetLocalMediaGumConstraints({
        micOn: mic,
        videoOn: video,
        micId: selectedMicId,
        camId: selectedCamId,
      }),
    );
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    syncMeetLocalTrackEnabled(stream, { mic, video });
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    await refreshDeviceList();
    return stream;
  }, [
    cameraAllowed,
    cameraTrackRef,
    localStreamRef,
    micOnRef,
    refreshDeviceList,
    replaceVideoTrackOnAllPeers,
    selectedCamId,
    selectedMicId,
    videoOnRef,
  ]);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setScreenPreviewStream(null);
    cameraTrackRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, [cameraTrackRef, localStreamRef, screenStreamRef]);

  const toggleMic = useCallback(() => {
    setMicOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = next;
      });
      void announceMediaPresence(next, videoOnRef.current);
      return next;
    });
  }, [announceMediaPresence, localStreamRef, setMicOn, videoOnRef]);

  /** Host remote-mute: force the local mic off. No-op when already muted. */
  const muteMic = useCallback((): boolean => {
    if (!micOnRef.current) return false;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setMicOn(false);
    void announceMediaPresence(false, videoOnRef.current);
    return true;
  }, [announceMediaPresence, localStreamRef, micOnRef, setMicOn, videoOnRef]);

  /**
   * Remote unmute is not applied. Forcing `track.enabled = true` would open
   * the mic without consent. Local unmute stays on `toggleMic` until a
   * consent UI exists.
   */
  const unmuteMic = useCallback((): boolean => false, []);

  const toggleVideo = useCallback(() => {
    setVideoOn((prev) => {
      if (!prev && !cameraAllowed()) return prev;
      const next = !prev;
      if (next && (localStreamRef.current?.getVideoTracks().length ?? 0) === 0) {
        void ensureLocalMedia().then((stream) => {
          syncMeetLocalTrackEnabled(stream, { mic: micOnRef.current, video: true });
          void announceMediaPresence(micOnRef.current, true);
        });
        return next;
      }
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
      void announceMediaPresence(micOnRef.current, next);
      return next;
    });
  }, [
    announceMediaPresence,
    cameraAllowed,
    ensureLocalMedia,
    localStreamRef,
    micOnRef,
    setVideoOn,
  ]);

  const publishScreen = useCallback(
    (mode: ScreenOptimize, trackId: string | null) => {
      screenModeRef.current = mode;
      setScreenModeState(mode);
      meetRtc.setEncodingPrefs({ screenMode: mode, screenTrackId: trackId });
    },
    [meetRtc],
  );

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenPreviewStream(null);
    const cameraTrack = cameraTrackRef.current;
    if (cameraTrack) await replaceVideoTrackOnAllPeers(cameraTrack);
    setScreenOn(false);
    publishScreen("text", null);
    void announceMediaPresence(micOnRef.current, videoOnRef.current, false);
  }, [
    announceMediaPresence,
    cameraTrackRef,
    micOnRef,
    publishScreen,
    replaceVideoTrackOnAllPeers,
    screenStreamRef,
    setScreenOn,
    videoOnRef,
  ]);

  const setScreenOptimize = useCallback(
    async (mode: ScreenOptimize) => {
      const track = screenStreamRef.current?.getVideoTracks()[0];
      if (!track) return;
      await applyScreenOptimize(track, mode, readMeetLowData());
      publishScreen(mode, track.id);
    },
    [publishScreen, screenStreamRef],
  );

  const startScreenShare = useCallback(
    async (mode: ScreenOptimize) => {
      if (screenStreamRef.current) {
        await setScreenOptimize(mode);
        return;
      }
      if (!isDisplayCaptureSupported()) {
        setError(meetLabels.shareScreenUnsupported);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: screenCaptureConstraints(mode, readMeetLowData()),
        });
        screenStreamRef.current = stream;
        setScreenPreviewStream(stream);
        const track = stream.getVideoTracks()[0];
        if (!track) return;
        track.contentHint = screenContentHint(mode);
        publishScreen(mode, track.id);
        await replaceVideoTrackOnAllPeers(track);
        track.onended = () => {
          void stopScreenShare();
        };
        setScreenOn(true);
        void announceMediaPresence(micOnRef.current, videoOnRef.current, true);
      } catch (e) {
        if (isDisplayCaptureUserCancel(e)) return;
        if (isDisplayCaptureUnsupportedError(e)) {
          setError(meetLabels.shareScreenUnsupported);
          return;
        }
        setError(e instanceof Error ? e.message : meetLabels.shareScreenFailed);
      }
    },
    [
      announceMediaPresence,
      micOnRef,
      publishScreen,
      replaceVideoTrackOnAllPeers,
      screenStreamRef,
      setError,
      setScreenOn,
      setScreenOptimize,
      stopScreenShare,
      videoOnRef,
    ],
  );

  const toggleScreenShare = useCallback(async () => {
    if (screenOn || screenStreamRef.current) await stopScreenShare();
    else await startScreenShare("text");
  }, [screenOn, screenStreamRef, startScreenShare, stopScreenShare]);

  useEffect(() => {
    return subscribeMeetLowData(() => {
      const track = screenStreamRef.current?.getVideoTracks()[0];
      if (!track) return;
      void applyScreenOptimize(track, screenModeRef.current, readMeetLowData());
    });
  }, [screenStreamRef]);

  const switchMic = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      const stream = localStreamRef.current;
      if (!stream) return;
      try {
        const updated = await navigator.mediaDevices.getUserMedia({
          audio: buildMeetAudioConstraints(deviceId),
          video: false,
        });
        const track = updated.getAudioTracks()[0];
        if (!track) return;
        track.enabled = micOn;
        const previous = stream.getAudioTracks()[0];
        if (previous && previous.id !== track.id) {
          stream.removeTrack(previous);
          previous.stop();
        }
        if (!stream.getAudioTracks().includes(track)) stream.addTrack(track);
        await replaceAudioTrackOnAllPeers(track);
        await refreshDeviceList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch microphone.");
      }
    },
    [
      localStreamRef,
      micOn,
      refreshDeviceList,
      replaceAudioTrackOnAllPeers,
      setError,
      setSelectedMicId,
    ],
  );

  const switchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCamId(deviceId);
      const stream = localStreamRef.current;
      if (!stream) return;
      try {
        const updated = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildMeetVideoConstraints(deviceId),
        });
        const track = updated.getVideoTracks()[0];
        if (!track) return;
        track.enabled = videoOn;
        const previous = stream.getVideoTracks()[0];
        if (previous && previous.id !== track.id) {
          stream.removeTrack(previous);
          previous.stop();
        }
        if (!stream.getVideoTracks().includes(track)) stream.addTrack(track);
        cameraTrackRef.current = track;
        if (!screenOn) {
          await replaceVideoTrackOnAllPeers(track);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        }
        await refreshDeviceList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch camera.");
      }
    },
    [
      cameraTrackRef,
      localStreamRef,
      refreshDeviceList,
      replaceVideoTrackOnAllPeers,
      screenOn,
      setError,
      setSelectedCamId,
      videoOn,
    ],
  );

  const getLocalStream = useCallback(() => localStreamRef.current, [localStreamRef]);

  return {
    localVideoRef,
    getLocalStream,
    screenPreviewStream,
    audioInputs,
    audioOutputs,
    videoInputs,
    selectedMicId,
    selectedCamId,
    ensureLocalMedia,
    stopLocalMedia,
    toggleMic,
    muteMic,
    unmuteMic,
    toggleVideo,
    toggleScreenShare,
    screenMode,
    startScreenShare,
    setScreenOptimize,
    stopScreenShare,
    switchMic,
    switchCamera,
  };
}
