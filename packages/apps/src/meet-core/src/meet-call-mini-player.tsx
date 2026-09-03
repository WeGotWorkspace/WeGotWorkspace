import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2, Mic, MicOff, PhoneOff, Users } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { useMeetCallStoreContext } from "@/meet-core/src/meet-call-provider";
import type { MeetCallStore } from "@/meet-core/src/meet-call-store";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetRemoteAudio, remoteParticipantHasAudio } from "@/meet-core/src/meet-remote-audio";
import { meetSearchFromRoom } from "@/meet-core/src/meet-route-search";
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
  const [, setClockTick] = useState(0);
  const [audioPlayNonce, setAudioPlayNonce] = useState(0);

  const callEngaged = snapshot.status === "in-call" || snapshot.status === "waiting";
  const visible = callEngaged && !pathname.startsWith("/meet");
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

  if (!visible) return null;

  const participantCount = snapshot.participants.length + 1;
  const meta =
    snapshot.status === "waiting"
      ? meetLabels.miniPlayerWaiting
      : [formatElapsed(snapshot.startedAt), meetLabels.participantsShort(participantCount)]
          .filter(Boolean)
          .join(" · ");

  const resumeRemoteAudio = () => {
    setAudioPlayNonce((nonce) => nonce + 1);
  };

  const returnToCall = () => {
    resumeRemoteAudio();
    void navigate({ to: "/meet", search: meetSearchFromRoom(snapshot.roomCode) });
  };

  return (
    <div
      className="meet-mini-player"
      role="complementary"
      aria-label={meetLabels.miniPlayerLabel}
      onPointerDown={resumeRemoteAudio}
    >
      {remoteAudioPeers.map((peer) => (
        <MeetRemoteAudio key={peer.id} stream={peer.stream} playNonce={audioPlayNonce} />
      ))}
      <button
        type="button"
        className="meet-mini-player__preview"
        onClick={returnToCall}
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
          {snapshot.micOn ? (
            <Mic className="size-3 shrink-0" />
          ) : (
            <MicOff className="meet-mini-player__mic-off size-3 shrink-0" />
          )}
          <span className="truncate">{snapshot.roomCode ?? meetLabels.miniPlayerLabel}</span>
        </span>
        <span className="meet-mini-player__meta">
          <Users className="size-3 shrink-0" />
          <span className="truncate">{meta}</span>
        </span>
      </div>
      <div className="meet-mini-player__actions">
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
