import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type MeetStreamVideoProps = {
  stream: MediaStream | null;
  className?: string;
  mirrored?: boolean;
  /**
   * Mute speaker playback. Required for local camera/mic/screen preview — the
   * capture track must never loop through speakers. Remote tiles stay unmuted.
   */
  muted?: boolean;
  /** When set, detect blank/zero-size frames (remote camera off while track stays "live") and notify. */
  onPresentationViable?: (viable: boolean) => void;
};

export function MeetStreamVideo({
  stream,
  className,
  mirrored = false,
  muted = false,
  onPresentationViable,
}: MeetStreamVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const onPresentationViableRef = useRef(onPresentationViable);
  onPresentationViableRef.current = onPresentationViable;

  useEffect(() => {
    const node = ref.current;
    if (!node || !stream) return;

    const play = () => {
      void node.play().catch(() => {
        // Autoplay may resume once the user has joined the call.
      });
    };

    node.muted = muted;
    node.defaultMuted = muted;
    node.volume = muted ? 0 : 1;
    node.srcObject = stream;
    play();

    const onAddTrack = () => play();
    stream.addEventListener("addtrack", onAddTrack);

    return () => {
      stream.removeEventListener("addtrack", onAddTrack);
      node.srcObject = null;
    };
  }, [muted, stream]);

  useEffect(() => {
    const el = ref.current;
    const notify = onPresentationViableRef.current;
    if (!el || !stream || !notify) return;

    let badFrames = 0;
    let rafId = 0;
    let intervalId = 0;

    const applyMetrics = () => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      if (w > 2 && h > 2) {
        badFrames = 0;
        notify(true);
      } else if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        badFrames += 1;
        if (badFrames >= 12) notify(false);
      }
    };

    const onLoaded = () => {
      badFrames = 0;
      notify(true);
    };

    el.addEventListener("loadeddata", onLoaded);

    if (typeof el.requestVideoFrameCallback === "function") {
      const tick: VideoFrameRequestCallback = () => {
        applyMetrics();
        rafId = el.requestVideoFrameCallback(tick);
      };
      rafId = el.requestVideoFrameCallback(tick);
    } else {
      intervalId = window.setInterval(applyMetrics, 350);
    }

    return () => {
      el.removeEventListener("loadeddata", onLoaded);
      if (typeof el.cancelVideoFrameCallback === "function" && rafId) {
        el.cancelVideoFrameCallback(rafId);
      }
      if (intervalId) window.clearInterval(intervalId);
      notify(true);
    };
  }, [stream]);

  if (!stream) return null;

  return (
    <video
      ref={ref}
      autoPlay
      muted={muted}
      playsInline
      className={cn("meet-stream-video", className)}
      style={{
        transform: mirrored ? "scaleX(-1)" : "scaleX(1)",
      }}
    />
  );
}
