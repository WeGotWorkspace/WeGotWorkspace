import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  isDisplayCaptureSupported,
  isDisplayCaptureUnsupportedError,
  isDisplayCaptureUserCancel,
} from "@/meet-core/src/meet-display-capture";
import { readMeetLowData, subscribeMeetLowData } from "@/lib/meet-low-data";
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

  const cameraAllowed = useCallback(() => cameraBlockedRef?.current !== true, [cameraBlockedRef]);

  /**
   * What the user wants right now. Read after every `getUserMedia`: the prompt
   * can stay open for seconds, and the toggles may have changed meanwhile.
   */
  const currentMediaWanted = useCallback(
    () => ({ mic: micOnRef.current, video: videoOnRef.current && cameraAllowed() }),
    [cameraAllowed, micOnRef, videoOnRef],
  );

  const ensureLocalMedia = useCallback(async () => {
    const mic = micOnRef.current;
    const video = videoOnRef.current && cameraAllowed();
    const current = localStreamRef.current;
    if (current) {
      if (video && current.getVideoTracks().length === 0) {
        const updated = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildMeetVideoConstraints(selectedCamId ?? undefined),
        });
        const track = updated.getVideoTracks()[0];
        // The toggle and the shell's mount effect can both open a camera, and the
        // call may have ended during the prompt: keep at most one camera track.
        const stale = localStreamRef.current !== current || current.getVideoTracks().length > 0;
        if (track && stale) track.stop();
        else if (track) {
          current.addTrack(track);
          cameraTrackRef.current = track;
          if (localVideoRef.current) localVideoRef.current.srcObject = current;
          await meetRtc.replaceVideoTrack(track);
        }
      }
      syncMeetLocalTrackEnabled(current, currentMediaWanted());
      return current;
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
    syncMeetLocalTrackEnabled(stream, currentMediaWanted());
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    await refreshDeviceList();
    return stream;
  }, [
    cameraAllowed,
    cameraTrackRef,
    currentMediaWanted,
    localStreamRef,
    micOnRef,
    refreshDeviceList,
    meetRtc,
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
    const next = !videoOnRef.current;
    if (next && !cameraAllowed()) return;
    // Write the toggle first: `ensureLocalMedia` reads `videoOnRef` to decide
    // whether to open the camera (an audio-only join has no camera track yet).
    setVideoOn(next);
    if (next && (localStreamRef.current?.getVideoTracks().length ?? 0) === 0) {
      void ensureLocalMedia().then(
        (stream) => {
          const wanted = currentMediaWanted();
          syncMeetLocalTrackEnabled(stream, wanted);
          void announceMediaPresence(wanted.mic, wanted.video);
        },
        (e: unknown) => {
          setVideoOn(false);
          setError(e instanceof Error ? e.message : "Could not turn the camera on.");
        },
      );
      return;
    }
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    void announceMediaPresence(micOnRef.current, next);
  }, [
    announceMediaPresence,
    cameraAllowed,
    currentMediaWanted,
    ensureLocalMedia,
    localStreamRef,
    micOnRef,
    setError,
    setVideoOn,
    videoOnRef,
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
    if (cameraTrack) await meetRtc.replaceVideoTrack(cameraTrack);
    setScreenOn(false);
    publishScreen("text", null);
    void announceMediaPresence(micOnRef.current, videoOnRef.current, false);
  }, [
    announceMediaPresence,
    cameraTrackRef,
    micOnRef,
    publishScreen,
    meetRtc,
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
        await meetRtc.replaceVideoTrack(track);
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
      meetRtc,
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
        track.enabled = micOnRef.current;
        const previous = stream.getAudioTracks()[0];
        if (previous && previous.id !== track.id) {
          stream.removeTrack(previous);
          previous.stop();
        }
        if (!stream.getAudioTracks().includes(track)) stream.addTrack(track);
        await meetRtc.replaceAudioTrack(track);
        await refreshDeviceList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch microphone.");
      }
    },
    [localStreamRef, micOnRef, refreshDeviceList, meetRtc, setError, setSelectedMicId],
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
        track.enabled = currentMediaWanted().video;
        const previous = stream.getVideoTracks()[0];
        if (previous && previous.id !== track.id) {
          stream.removeTrack(previous);
          previous.stop();
        }
        if (!stream.getVideoTracks().includes(track)) stream.addTrack(track);
        cameraTrackRef.current = track;
        if (!screenOn) {
          await meetRtc.replaceVideoTrack(track);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        }
        await refreshDeviceList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch camera.");
      }
    },
    [
      cameraTrackRef,
      currentMediaWanted,
      localStreamRef,
      refreshDeviceList,
      meetRtc,
      screenOn,
      setError,
      setSelectedCamId,
    ],
  );

  // A toggle switched off from anywhere (instance video limit, call reset) must
  // stop sending. Only ever switches off: turning a device on needs the user.
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    if (!micOn) for (const track of stream.getAudioTracks()) track.enabled = false;
    if (!videoOn) for (const track of stream.getVideoTracks()) track.enabled = false;
  }, [localStreamRef, micOn, videoOn]);

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
