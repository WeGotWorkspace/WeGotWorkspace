import { useEffect, useState } from "react";
import {
  meetMicRms,
  shouldPublishMeetMicLevel,
  smoothMeetMicLevel,
} from "@/meet-core/src/meet-mic-level";

/**
 * Smoothed RMS of a local mic track for lobby "Speak to test" feedback.
 * Does not connect to destination — preview playback stays muted separately.
 */
export function useMeetMicLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  const audioKey =
    stream
      ?.getAudioTracks()
      .filter((track) => track.readyState === "live")
      .map((track) => track.id)
      .join(",") ?? "";

  useEffect(() => {
    if (!enabled || !stream || typeof AudioContext === "undefined") {
      setLevel(0);
      return;
    }
    const tracks = stream.getAudioTracks().filter((track) => track.readyState === "live");
    if (tracks.length === 0) {
      setLevel(0);
      return;
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream(tracks));
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let displayed = 0;
    let published = 0;
    let lastPublishAt = 0;
    let cancelled = false;
    void context.resume();

    const tick = (now: number) => {
      if (cancelled) return;
      analyser.getByteTimeDomainData(samples);
      displayed = smoothMeetMicLevel(displayed, meetMicRms(samples));
      if (shouldPublishMeetMicLevel(published, displayed, now, lastPublishAt)) {
        published = displayed;
        lastPublishAt = now;
        setLevel(displayed);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [audioKey, enabled, stream]);

  return level;
}
