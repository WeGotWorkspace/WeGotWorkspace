import { useCallback, useEffect, useState } from "react";
import { partitionMeetMediaDevices } from "@/meet-core/src/meet-device-utils";

/**
 * Live `enumerateDevices()` lists for Meet device menus.
 * Microphones stay `audioinput`; speakers stay `audiooutput`.
 */
export function useMeetMediaDevices() {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);

  const refreshDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const partitioned = partitionMeetMediaDevices(devices);
      setAudioInputs(partitioned.audioInputs);
      setAudioOutputs(partitioned.audioOutputs);
      setVideoInputs(partitioned.videoInputs);
    } catch {
      // Ignore read failures from unsupported browsers.
    }
  }, []);

  useEffect(() => {
    void refreshDeviceList();
    const media = navigator.mediaDevices;
    if (!media) return;
    const onDeviceChange = () => void refreshDeviceList();
    media.addEventListener("devicechange", onDeviceChange);
    return () => media.removeEventListener("devicechange", onDeviceChange);
  }, [refreshDeviceList]);

  return { audioInputs, audioOutputs, videoInputs, refreshDeviceList };
}
