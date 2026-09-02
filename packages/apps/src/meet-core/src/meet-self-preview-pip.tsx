import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic, MicOff, PictureInPicture2 } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { cn } from "@/lib/utils";

type MeetSelfPreviewPiPProps = {
  name: string;
  videoOn: boolean;
  micOn: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
};

function canRequestBrowserPiP(video: HTMLVideoElement | null) {
  if (!video) return false;
  return (
    "pictureInPictureEnabled" in document &&
    (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled &&
    typeof (video as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })
      .requestPictureInPicture === "function"
  );
}

export function MeetSelfPreviewPiP({
  name,
  videoOn,
  micOn,
  videoRef,
  onInfo,
  onError,
}: MeetSelfPreviewPiPProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const mirrorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mirrorRafRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isBrowserPiP, setIsBrowserPiP] = useState(false);
  const [pipAspectRatio, setPipAspectRatio] = useState<number | null>(null);

  const clampPosition = (x: number, y: number) => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - root.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - root.offsetHeight);
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    };
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoOn) {
      setPipAspectRatio(null);
      return;
    }
    const update = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      setPipAspectRatio(w > 0 && h > 0 ? w / h : null);
    };
    update();
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [videoOn, videoRef]);

  useEffect(() => {
    setPosition((prev) => (prev ? clampPosition(prev.x, prev.y) : prev));
  }, [pipAspectRatio, isBrowserPiP]);

  useEffect(() => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent || position) return;
    const defaultX = Math.max(0, parent.clientWidth - root.offsetWidth - 12);
    const defaultY = 12;
    setPosition({ x: defaultX, y: defaultY });
  }, [position]);

  useEffect(() => {
    const handleResize = () => {
      if (!position) return;
      setPosition((prev) => {
        if (!prev) return prev;
        return clampPosition(prev.x, prev.y);
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position]);

  const toggleBrowserPiP = async () => {
    const video = pipVideoRef.current;
    if (!video) {
      onInfo(meetLabels.pipNotReady);
      return;
    }
    if (!video.srcObject) {
      onInfo(meetLabels.pipNotReady);
      return;
    }
    const doc = document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };
    if (!canRequestBrowserPiP(video)) {
      onInfo(meetLabels.pipUnsupported);
      return;
    }
    try {
      if (doc.pictureInPictureElement && doc.exitPictureInPicture) {
        await doc.exitPictureInPicture();
      } else {
        await video.play().catch(() => {
          // Autoplay may already be active on the visible preview.
        });
        await video.requestPictureInPicture();
      }
    } catch {
      onError(meetLabels.pipError);
    }
  };

  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video) return;
    const onEnter = () => setIsBrowserPiP(true);
    const onLeave = () => setIsBrowserPiP(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      setIsBrowserPiP(false);
    };
  }, [videoOn]);

  /**
   * Browser Picture-in-Picture uses raw decoded frames; CSS `scaleX(-1)` on the page video does
   * not flip system PiP. Mirror by drawing the visible preview into a canvas stream for PiP only.
   */
  useLayoutEffect(() => {
    const stopMirrorLoop = () => {
      if (mirrorRafRef.current != null) {
        cancelAnimationFrame(mirrorRafRef.current);
        mirrorRafRef.current = null;
      }
      const pip = pipVideoRef.current;
      if (pip) pip.srcObject = null;
    };

    if (!videoOn) {
      stopMirrorLoop();
      return;
    }

    const display = videoRef.current;
    const pip = pipVideoRef.current;
    const canvas = mirrorCanvasRef.current;
    if (!display || !pip || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      stopMirrorLoop();
      return;
    }

    const stream = canvas.captureStream(30);
    pip.srcObject = stream;
    void pip.play().catch(() => {
      // Autoplay may already be active once frames reach the canvas stream.
    });

    const tick = () => {
      mirrorRafRef.current = requestAnimationFrame(tick);
      const w = display.videoWidth;
      const h = display.videoHeight;
      if (!w || !h) return;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(display, 0, 0, w, h);
      ctx.restore();
    };

    mirrorRafRef.current = requestAnimationFrame(tick);

    return () => {
      stopMirrorLoop();
    };
  }, [videoOn, videoRef]);

  useEffect(() => {
    const video = pipVideoRef.current;
    if (!video || !videoOn || !canRequestBrowserPiP(video)) return;

    const doc = document as Document & {
      pictureInPictureElement?: Element | null;
      exitPictureInPicture?: () => Promise<void>;
    };

    const onVisibilityChange = () => {
      const currentVideo = pipVideoRef.current;
      if (!currentVideo?.srcObject) return;
      const isHidden = document.visibilityState === "hidden";
      if (isHidden) {
        if (doc.pictureInPictureElement) return;
        void currentVideo
          .play()
          .catch(() => {
            // Autoplay may already be active on the visible preview.
          })
          .then(() => currentVideo.requestPictureInPicture())
          .catch(() => {
            // Browsers can block PiP auto-entry without recent user interaction.
          });
        return;
      }
      if (doc.pictureInPictureElement === currentVideo && doc.exitPictureInPicture) {
        void doc.exitPictureInPicture().catch(() => {
          // Ignore close failures; user might have already dismissed PiP.
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [videoOn]);

  const handlePointerDown = (event: {
    target: EventTarget | null;
    clientX: number;
    clientY: number;
  }) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const root = rootRef.current;
    if (!root) return;
    const start = position ?? { x: 12, y: 12 };
    const startX = event.clientX;
    const startY = event.clientY;
    setDragging(true);
    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setPosition(clampPosition(start.x + deltaX, start.y + deltaY));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const x = position?.x ?? 12;
  const y = position?.y ?? 12;

  return (
    <div
      ref={rootRef}
      onPointerDown={handlePointerDown}
      className={cn(
        "meet-pip z-20",
        isBrowserPiP ? "meet-pip--sm" : "meet-pip--md",
        dragging && "meet-pip--dragging",
      )}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        ...(pipAspectRatio != null ? { aspectRatio: pipAspectRatio } : {}),
      }}
    >
      {videoOn ? (
        <>
          <div className="meet-pip__video-wrap">
            <video ref={videoRef} autoPlay muted playsInline className="meet-pip__video" />
          </div>
          <canvas ref={mirrorCanvasRef} className="meet-pip__mirror-canvas" aria-hidden />
          <video
            ref={pipVideoRef}
            autoPlay
            muted
            playsInline
            className="meet-pip__pip-source"
            aria-hidden
          />
        </>
      ) : (
        <div className="flex h-full items-center justify-center">
          <UserAvatar displayName={name} compact size="lg" />
        </div>
      )}
      <div className="meet-pip__label">
        {micOn ? <Mic className="size-3" /> : <MicOff className="size-3 text-red-400" />}
        <span className="max-w-24 truncate">{meetLabels.selfPreview(name)}</span>
      </div>
      <IconButton
        onClick={() => void toggleBrowserPiP()}
        icon={<PictureInPicture2 />}
        label={meetLabels.openSystemPip}
        size="sm"
        variant="subtle"
        className="meet-pip__pip-button"
      />
    </div>
  );
}
