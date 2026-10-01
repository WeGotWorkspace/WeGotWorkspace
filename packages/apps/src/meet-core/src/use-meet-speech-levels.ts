import { useEffect, useRef, useState } from "react";
import { meetMicRms, smoothMeetMicLevel } from "@/meet-core/src/meet-mic-level";

/** How often the mini-player samples local and remote speech. */
export const MEET_MINI_PLAYER_LEVEL_SAMPLE_MS = 100;

export type MeetSpeechSource = {
  id: string;
  stream: MediaStream | null;
  /** When false the level stays 0 (mic muted or not yet announced). */
  enabled: boolean;
};

export function meetSpeechSourceSignature(sources: readonly MeetSpeechSource[]): string {
  return sources
    .map((source) => {
      const tracks = liveAudioTracks(source)
        .map((track) => track.id)
        .join("+");
      return `${source.id}:${tracks}`;
    })
    .join("|");
}

function liveAudioTracks(source: MeetSpeechSource): MediaStreamTrack[] {
  if (!source.enabled || !source.stream) return [];
  return source.stream.getAudioTracks().filter((track) => track.readyState === "live");
}

/**
 * Smoothed 0–1 speech levels for the mini-player. Samples only while `active`
 * so the full call stage does not keep an extra audio graph.
 */
export function useMeetSpeechLevels(
  sources: readonly MeetSpeechSource[],
  active: boolean,
): Readonly<Record<string, number>> {
  const [levels, setLevels] = useState<Readonly<Record<string, number>>>({});
  // Latest streams for the effect without restarting it when only the array identity changes.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const signature = meetSpeechSourceSignature(sources);

  useEffect(() => {
    if (!active || typeof AudioContext === "undefined") {
      setLevels({});
      return;
    }

    const audible = sourcesRef.current.flatMap((source) => {
      const tracks = liveAudioTracks(source);
      if (!source.stream || tracks.length === 0) return [];
      return [{ id: source.id, stream: source.stream }];
    });
    if (audible.length === 0) {
      setLevels({});
      return;
    }

    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      // Browsers can refuse a new context; silence keeps the last preview subject.
      setLevels({});
      return;
    }

    const nodes = audible.flatMap((source) => {
      try {
        const media = context.createMediaStreamSource(source.stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        media.connect(analyser);
        return [
          {
            id: source.id,
            media,
            analyser,
            samples: new Uint8Array(analyser.fftSize),
          },
        ];
      } catch {
        // Ended or video-only streams cannot feed an analyser; that peer stays at 0.
        return [];
      }
    });

    if (nodes.length === 0) {
      void context.close();
      setLevels({});
      return;
    }

    const displayed = new Map<string, number>();
    const published = new Map<string, number>();
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      let changed = false;
      for (const node of nodes) {
        node.analyser.getByteTimeDomainData(node.samples);
        const smoothed = smoothMeetMicLevel(displayed.get(node.id) ?? 0, meetMicRms(node.samples));
        displayed.set(node.id, smoothed);
        const quantized = Math.round(smoothed * 100) / 100;
        next[node.id] = quantized;
        if (published.get(node.id) !== quantized) changed = true;
        published.set(node.id, quantized);
      }
      if (changed) setLevels(next);
    };

    const intervalId = window.setInterval(tick, MEET_MINI_PLAYER_LEVEL_SAMPLE_MS);
    void context
      .resume()
      .then(() => {
        if (!cancelled) tick();
      })
      .catch(() => {
        // Autoplay policy can reject resume. The interval still samples if the context starts.
      });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      for (const node of nodes) node.media.disconnect();
      void context.close();
    };
  }, [active, signature]);

  return levels;
}
