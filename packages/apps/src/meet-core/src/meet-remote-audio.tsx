import { useEffect, useRef } from "react";

type MeetRemoteAudioProps = {
  stream: MediaStream;
  /** Bump after a user gesture to retry play() when autoplay was blocked. */
  playNonce?: number;
};

/**
 * Hidden audio sink for a remote MediaStream. Video tiles normally carry audio via
 * `<video>`; this keeps remote audio alive when those tiles are unmounted (e.g. mini-player).
 */
export function MeetRemoteAudio({ stream, playNonce = 0 }: MeetRemoteAudioProps) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const play = () => {
      void node.play().catch(() => {
        // Autoplay may require a user gesture; callers can bump playNonce after interaction.
      });
    };

    node.srcObject = stream;
    play();

    const onAddTrack = () => play();
    stream.addEventListener("addtrack", onAddTrack);

    return () => {
      stream.removeEventListener("addtrack", onAddTrack);
      node.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (playNonce === 0) return;
    const node = ref.current;
    if (!node) return;
    void node.play().catch(() => {});
  }, [playNonce]);

  return <audio ref={ref} autoPlay playsInline />;
}

export function remoteParticipantHasAudio(
  stream: MediaStream | null | undefined,
): stream is MediaStream {
  return Boolean(stream && stream.getAudioTracks().length > 0);
}
