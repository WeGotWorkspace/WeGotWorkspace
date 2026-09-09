import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import {
  meetCallMiniPlayerVisible,
  meetResumeCallNavigateTarget,
} from "@/meet-core/src/meet-call-resume";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  meetClampMiniPlayerPosition,
  meetMiniPlayerDragExceededThreshold,
} from "@/meet-core/src/meet-mini-player-position";
import { MeetRemoteAudio, remoteParticipantHasAudio } from "@/meet-core/src/meet-remote-audio";
import "@/meet-core/src/meet-call-mini-player.css";

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "";
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Floating "call continues" card shown outside `/meet` while a call is active.
 * Renders nothing without the suite-level call store (mock/Storybook trees).
 */
export function MeetCallMiniPlayer() {
  const store = useMeetCallStoreContext();
  if (!store) return null;
  return <MeetCallMiniPlayerCard store={store} />;
}

function MeetCallMiniPlayerCard({ store }: { store: MeetCallStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const draggedRef = useRef(false);
  const [, setClockTick] = useState(0);
  const [audioPlayNonce, setAudioPlayNonce] = useState(0);
  const [dragging, setDragging] = useState(false);

  const callEngaged = snapshot.status === "in-call" || snapshot.status === "waiting";
  // Outside /meet the card always accompanies an engaged call. Inside /meet it
  // only shows when the chat workspace parked the call (another channel on
  // screen, or Meet unmounted while the call continues). Legacy shells never
  // park, keeping it hidden over the full-screen guest stage.
  const visible = meetCallMiniPlayerVisible({
    callEngaged,
    onMeetPath: pathname.startsWith("/meet"),
    callUiParked: snapshot.callUiParked,
  });
  const showVideo = visible && snapshot.videoOn && !snapshot.screenOn;
  const remoteAudioPeers = visible
    ? snapshot.participants.flatMap((peer) =>
        remoteParticipantHasAudio(peer.stream) ? [{ id: peer.id, stream: peer.stream }] : [],
      )
    : [];

  useEffect(() => {
    if (!showVideo) return;
    const node = videoRef.current;
    if (!node) return;
    node.srcObject = store.localStreamRef.current;
    return () => {
      node.srcObject = null;
    };
  }, [showVideo, store]);

  useEffect(() => {
    if (!visible || !snapshot.startedAt) return;
    const id = window.setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(id);
  }, [visible, snapshot.startedAt]);

  const hasCustomPosition = snapshot.miniPlayerPosition != null;
  useEffect(() => {
    if (!hasCustomPosition) return;
    const onResize = () => {
      const current = store.getSnapshot().miniPlayerPosition;
      const root = rootRef.current;
      if (!current || !root) return;
      store.setMiniPlayerPosition(
        meetClampMiniPlayerPosition({
          x: current.x,
          y: current.y,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          width: root.offsetWidth,
          height: root.offsetHeight,
        }),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hasCustomPosition, store]);

  if (!visible) return null;

  const participantCount = snapshot.participants.length + 1;
  const meta =
    snapshot.status === "waiting"
      ? meetLabels.miniPlayerWaiting
      : [formatElapsed(snapshot.startedAt), meetLabels.participantsShort(participantCount)]
          .filter(Boolean)
          .join(" · ");

  const position = snapshot.miniPlayerPosition;

  const resumeRemoteAudio = () => {
    setAudioPlayNonce((nonce) => nonce + 1);
  };

  const returnToCall = () => {
    resumeRemoteAudio();
    // Parked call inside /meet: re-select the call's channel instead of
    // navigating (the workspace registered this callback; search alone would
    // not change the internal channel selection).
    const focusCallChannel = store.focusCallChannelRef.current;
    if (pathname.startsWith("/meet") && focusCallChannel) {
      focusCallChannel();
      return;
    }
    void navigate(
      meetResumeCallNavigateTarget({
        liveCallChannelId: snapshot.liveCallChannelId,
        liveCallChannelKind: snapshot.liveCallChannelKind,
        roomCode: snapshot.roomCode,
      }),
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    resumeRemoteAudio();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest(".meet-mini-player__actions")) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    dragStartRef.current = {
      x: rect.left,
      y: rect.top,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    draggedRef.current = false;
    setDragging(true);
    root.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const root = rootRef.current;
    if (!start || !root) return;
    const dx = event.clientX - start.pointerX;
    const dy = event.clientY - start.pointerY;
    const exceeded = meetMiniPlayerDragExceededThreshold(dx, dy);
    if (exceeded) draggedRef.current = true;
    if (!draggedRef.current && !position) return;
    store.setMiniPlayerPosition(
      meetClampMiniPlayerPosition({
        x: start.x + dx,
        y: start.y + dy,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        width: root.offsetWidth,
        height: root.offsetHeight,
      }),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setDragging(false);
    if (rootRef.current?.hasPointerCapture(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "meet-mini-player",
        position && "meet-mini-player--moved",
        dragging && "meet-mini-player--dragging",
      )}
      role="complementary"
      aria-label={meetLabels.miniPlayerLabel}
      style={position ? { left: position.x, top: position.y } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {remoteAudioPeers.map((peer) => (
        <MeetRemoteAudio key={peer.id} stream={peer.stream} playNonce={audioPlayNonce} />
      ))}
      <button
        type="button"
        className="meet-mini-player__preview"
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          returnToCall();
        }}
        aria-label={meetLabels.returnToCall}
      >
        {showVideo ? (
          <video ref={videoRef} autoPlay muted playsInline className="meet-mini-player__video" />
        ) : (
          <UserAvatar displayName={snapshot.displayName || "You"} compact size="sm" />
        )}
      </button>
      <div className="meet-mini-player__info">
        <span className="meet-mini-player__room">
          <span className="truncate">
            {snapshot.callLabel?.trim() || meetLabels.miniPlayerTitle}
          </span>
        </span>
        <span className="meet-mini-player__meta">{meta}</span>
      </div>
      <div className="meet-mini-player__actions">
        <IconButton
          onClick={() => store.toggleMicRef.current?.()}
          icon={snapshot.micOn ? <Mic /> : <MicOff />}
          label={snapshot.micOn ? meetLabels.disableAudio : meetLabels.enableAudio}
          size="sm"
          variant="ghost"
          className={snapshot.micOn ? undefined : "meet-mini-player__media-off"}
        />
        <IconButton
          onClick={() => store.toggleVideoRef.current?.()}
          icon={snapshot.videoOn ? <Video /> : <VideoOff />}
          label={snapshot.videoOn ? meetLabels.disableVideo : meetLabels.enableVideo}
          size="sm"
          variant="ghost"
          className={snapshot.videoOn ? undefined : "meet-mini-player__media-off"}
        />
        <IconButton
          onClick={returnToCall}
          icon={<Maximize2 />}
          label={meetLabels.returnToCall}
          size="sm"
          variant="ghost"
        />
        <IconButton
          onClick={() => void store.leaveRef.current?.()}
          icon={<PhoneOff />}
          label={meetLabels.hangUp}
          size="sm"
          variant="ghost"
          className="meet-mini-player__hang-up"
        />
      </div>
    </div>
  );
}
