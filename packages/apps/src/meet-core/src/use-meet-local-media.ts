import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  isDisplayCaptureSupported,
  isDisplayCaptureUnsupportedError,
  isDisplayCaptureUserCancel,
} from "@/meet-core/src/meet-display-capture";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { syncMeetLocalTrackEnabled } from "@/meet-core/src/meet-local-track-enabled";
import {
  buildMeetAudioConstraints,
  buildMeetVideoConstraints,
  meetLocalMediaGumConstraints,
} from "@/meet-core/src/meet-media-constraints";
import type { useMeetRtc } from "@/meet-core/src/use-meet-rtc";

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
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
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

  const refreshDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
      setVideoInputs(devices.filter((device) => device.kind === "videoinput"));
    } catch {
      // Ignore read failures from unsupported browsers.
    }
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

  const ensureLocalMedia = useCallback(async () => {
    const mic = micOnRef.current;
    const video = videoOnRef.current;
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

  const toggleVideo = useCallback(() => {
    setVideoOn((prev) => {
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
  }, [announceMediaPresence, ensureLocalMedia, localStreamRef, micOnRef, setVideoOn]);

  const toggleScreenShare = useCallback(async () => {
    if (screenOn) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenPreviewStream(null);
      const cameraTrack = cameraTrackRef.current;
      if (cameraTrack) await replaceVideoTrackOnAllPeers(cameraTrack);
      setScreenOn(false);
      void announceMediaPresence(micOnRef.current, videoOnRef.current, false);
      return;
    }

    if (!isDisplayCaptureSupported()) {
      setError(meetLabels.shareScreenUnsupported);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenPreviewStream(stream);
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      await replaceVideoTrackOnAllPeers(track);
      track.onended = () => {
        void (async () => {
          if (!screenStreamRef.current) return;
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
          setScreenPreviewStream(null);
          const cameraTrack = cameraTrackRef.current;
          if (cameraTrack) await replaceVideoTrackOnAllPeers(cameraTrack);
          setScreenOn(false);
          void announceMediaPresence(micOnRef.current, videoOnRef.current, false);
        })();
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
  }, [
    announceMediaPresence,
    cameraTrackRef,
    micOnRef,
    replaceVideoTrackOnAllPeers,
    screenOn,
    screenStreamRef,
    setError,
    setScreenOn,
    videoOnRef,
  ]);

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

  useEffect(() => {
    void refreshDeviceList();
    const media = navigator.mediaDevices;
    if (!media) return;
    const onDeviceChange = () => void refreshDeviceList();
    media.addEventListener("devicechange", onDeviceChange);
    return () => media.removeEventListener("devicechange", onDeviceChange);
  }, [refreshDeviceList]);

  const getLocalStream = useCallback(() => localStreamRef.current, [localStreamRef]);

  return {
    localVideoRef,
    getLocalStream,
    screenPreviewStream,
    audioInputs,
    videoInputs,
    selectedMicId,
    selectedCamId,
    ensureLocalMedia,
    stopLocalMedia,
    toggleMic,
    muteMic,
    toggleVideo,
    toggleScreenShare,
    switchMic,
    switchCamera,
  };
}
