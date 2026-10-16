import { type CSSProperties, type ReactNode, useCallback, useState } from "react";
import { MessageSquare } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { meetCallBarMeta } from "@/meet-core/src/meet-call-bar";
import { MeetCallKnockQueue, MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { defaultMeetCallChatOpen } from "@/meet-core/src/meet-call-chat-panel";
import {
  meetCallGridColumns,
  meetCallPeerMicOn,
  meetCallPeerScreenSharing,
  type MeetCallSpotlightPeer,
} from "@/meet-core/src/meet-call-spotlight";
import { MEET_MINI_PLAYER_SPEECH_ON } from "@/meet-core/src/meet-mini-player-subject";
import { useMeetSpeechLevels } from "@/meet-core/src/use-meet-speech-levels";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import { MeetCallToolbar } from "@/meet-core/src/meet-call-toolbar";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { remoteVideoSuppressed } from "@/meet-core/src/meet-video-sender";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import { MeetStreamVideo } from "@/meet-core/src/meet-stream-video";
import { cn } from "@/lib/utils";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";

export type MeetCallExpandedProps = MeetCallStageRoomProps & {
  chat?: ReactNode;
  channelTitle?: string;
  onLeave?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  chatOpen?: boolean;
  defaultChatOpen?: boolean;
  onToggleChat?: () => void;
  /** Sample speech for the speaking tag. Off while the stage is parked. */
  monitorSpeech?: boolean;
  className?: string;
};

function selfPeer(
  room: MeetCallStageRoomProps,
): MeetCallSpotlightPeer & { stream: MediaStream | null } {
  return {
    id: room.controller.selfId ?? "self",
    name: room.displayName,
    stream: room.controller.getLocalStream(),
    disclosedMedia: { camera: room.controller.videoOn, mic: room.controller.micOn },
  };
}

function tileCaption(peer: MeetCallSpotlightPeer, isSelf: boolean): string | undefined {
  if (!isSelf && meetCallPeerScreenSharing(peer)) return meetLabels.presenting;
  return undefined;
}

function MeetCallChatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      onClick={onToggle}
      icon={<MessageSquare />}
      label={open ? meetLabels.toggleChatHide : meetLabels.toggleChatShow}
      size="md"
      variant="outline"
      active={open}
      aria-pressed={open}
    />
  );
}

export function MeetCallExpanded({
  chat: _chat,
  channelTitle,
  onLeave,
  sidebarOpen = false,
  onToggleSidebar,
  chatOpen: chatOpenProp,
  defaultChatOpen,
  onToggleChat,
  monitorSpeech = true,
  className,
  ...room
}: MeetCallExpandedProps) {
  const [uncontrolledChatOpen, setUncontrolledChatOpen] = useState(
    () => defaultChatOpen ?? defaultMeetCallChatOpen(),
  );
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const chatOpen = chatOpenProp ?? uncontrolledChatOpen;
  const toggleChat = useCallback(() => {
    onToggleChat?.();
    if (chatOpenProp === undefined) setUncontrolledChatOpen((open) => !open);
  }, [chatOpenProp, onToggleChat]);
  const self = selfPeer(room);
  const remotes = room.controller.peers;
  const sharing = room.controller.screenOn;
  const waitingForAdmission = room.controller.waitingForAdmission;
  const levels = useMeetSpeechLevels(
    [
      {
        id: self.id,
        stream: self.stream,
        enabled: room.controller.micOn,
      },
      ...remotes.map((peer) => ({
        id: peer.id,
        stream: peer.stream ?? null,
        enabled: meetCallPeerMicOn(peer),
      })),
    ],
    monitorSpeech && !waitingForAdmission,
  );
  // Knocker-side wait state replaces the grid. Members admit from the lobby
  // banner; guests never moderate knocks.
  const knockers = room.hasSignedInIdentity && !waitingForAdmission ? room.controller.knockers : [];
  const cancelKnock = useCallback(() => {
    onLeave?.();
    void room.controller.leave();
    // Both paths reset the same session state; the double leave is idempotent.
  }, [onLeave, room.controller]);
  const remoteIds = remotes.map((peer) => peer.id);
  const peers = [self, ...remotes];
  const pinnedPeer = pinnedId ? (peers.find((peer) => peer.id === pinnedId) ?? null) : null;
  // Screen share owns the featured area. A pin stays selected and takes that
  // area once the share stops.
  const showFilmstrip = sharing || pinnedPeer != null;
  const gridColumns = meetCallGridColumns(peers.length);
  const renderPeerTile = (peer: (typeof peers)[number], featured = false) => {
    const isSelf = peer.id === self.id;
    // A pinned peer is mounted in the featured area and again in the filmstrip.
    // Only the featured copy mounts the media element and plays that peer's audio.
    const duplicate = !sharing && pinnedPeer?.id === peer.id;
    const filmstripCopy = duplicate && !featured;
    const playbackMuted = isSelf || filmstripCopy;
    // A pin is the request to see that person. It beats the low-data cap,
    // which only applies to unpinned filmstrip and grid tiles.
    const hideVideo =
      !isSelf && !featured && remoteVideoSuppressed(peer.id, remoteIds, room.controller.lowData);
    return (
      <MeetPeerTile
        name={peer.name}
        stream={peer.stream ?? null}
        userId={peer.id}
        muted={playbackMuted}
        omitPlayback={filmstripCopy}
        spotlight={!showFilmstrip && peers.length === 1}
        speaking={(levels[peer.id] ?? 0) >= MEET_MINI_PLAYER_SPEECH_ON}
        pinned={peer.id === pinnedPeer?.id}
        onTogglePin={(next) => setPinnedId(next ? peer.id : null)}
        caption={room.controller.relayTiles[peer.id] ?? tileCaption(peer, isSelf)}
        remoteMedia={peer.remoteMedia}
        disclosedMedia={
          isSelf
            ? { camera: room.controller.videoOn, mic: room.controller.micOn }
            : peer.disclosedMedia
        }
        micOn={isSelf ? room.controller.micOn : undefined}
        onToggleMic={isSelf ? room.controller.toggleMic : undefined}
        onMuteParticipant={
          isSelf || !room.hasSignedInIdentity
            ? undefined
            : (muted) => void room.controller.mutePeer(peer.id, muted)
        }
        hideVideo={hideVideo}
      />
    );
  };
  const peerTiles = peers.map((peer) => (
    <li key={peer.id} className="meet-call-stage__grid-item">
      {renderPeerTile(peer)}
    </li>
  ));
  const title = channelTitle ? meetLabels.meetInChannel(channelTitle) : meetLabels.productName;

  return (
    <div className={cn("meet-call-stage meet-call-stage--expanded meet-call-expanded", className)}>
      <div className="meet-call-stage__chrome">
        <header className="meet-call-stage__header">
          <div className="meet-call-stage__header-start">
            {onToggleSidebar ? (
              <div className="meet-call-stage__sidebar-toggle">
                <WorkspaceSidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
              </div>
            ) : null}
            <div className="meet-call-stage__brand">
              <div className="meet-call-stage__copy">
                <h2 className="meet-call-stage__title">{title}</h2>
                <p className="meet-call-stage__meta">
                  {meetCallBarMeta(room.participantCount, room.controller.elapsedLabel)}
                </p>
              </div>
            </div>
          </div>
          <div className="meet-call-stage__header-actions">
            <MeetCallChatToggle open={chatOpen} onToggle={toggleChat} />
          </div>
        </header>

        {knockers.length > 0 ? (
          <MeetCallKnockQueue
            knockers={knockers}
            onAdmit={(peerId) => room.controller.admitKnocker(peerId)}
            onDeny={(peerId) => room.controller.denyKnocker(peerId)}
            onAdmitError={room.onToastError}
          />
        ) : null}

        {room.controller.relayBanner ? (
          <div className="meet-call-stage__relay" role="status">
            <p className="meet-call-stage__relay-message">{room.controller.relayBanner.message}</p>
            {room.controller.relayBanner.setupHref ? (
              <a
                className="meet-call-stage__relay-link"
                href={room.controller.relayBanner.setupHref}
              >
                {meetLabels.setUpRelay}
              </a>
            ) : null}
            {room.controller.relayBanner.docsHref ? (
              <a
                className="meet-call-stage__relay-link"
                href={room.controller.relayBanner.docsHref}
              >
                {meetLabels.relayDocs}
              </a>
            ) : null}
            {room.controller.relayBanner.planHref ? (
              <a
                className="meet-call-stage__relay-link"
                href={room.controller.relayBanner.planHref}
              >
                {meetLabels.relayPlan}
              </a>
            ) : null}
          </div>
        ) : null}

        {waitingForAdmission ? (
          <div className="meet-call-stage__body meet-call-stage__body--waiting">
            <MeetCallKnockWaiting
              variant="stage"
              channelTitle={channelTitle}
              onCancel={cancelKnock}
            />
          </div>
        ) : (
          <div className="meet-call-stage__body">
            {showFilmstrip ? (
              <div className="meet-call-stage__share" data-featured={sharing ? "share" : "pin"}>
                <div className="meet-call-stage__share-main">
                  {sharing ? (
                    room.controller.screenPreviewStream ? (
                      <MeetStreamVideo
                        stream={room.controller.screenPreviewStream}
                        muted
                        className="meet-call-stage__screen"
                      />
                    ) : (
                      <div className="meet-call-stage__screen-fallback">
                        {meetLabels.sharingScreen}
                      </div>
                    )
                  ) : pinnedPeer ? (
                    renderPeerTile(pinnedPeer, true)
                  ) : null}
                </div>
                <ul className="meet-call-stage__share-peers">{peerTiles}</ul>
              </div>
            ) : (
              <ul
                className="meet-call-stage__grid"
                data-count={peers.length}
                data-columns={gridColumns}
                style={{ "--meet-call-grid-columns": gridColumns } as CSSProperties}
              >
                {peerTiles}
              </ul>
            )}
          </div>
        )}

        {waitingForAdmission ? null : (
          <div className="meet-call-stage__dock">
            <MeetCallToolbar
              micOn={room.controller.micOn}
              videoOn={room.controller.videoOn}
              screenOn={room.controller.screenOn}
              callExitLabel={meetLabels.leave}
              callExitTitle={room.callExitTitle}
              callExitDescription={room.callExitDescription}
              cameras={room.cameras}
              microphones={room.microphones}
              speakers={room.speakers}
              activeCamera={room.activeCamera}
              activeMic={room.activeMic}
              activeSpeaker={room.activeSpeaker}
              onToggleMic={room.controller.toggleMic}
              onToggleVideo={room.controller.toggleVideo}
              videoLocked={room.controller.cameraSendingDisabled}
              onToggleScreenShare={() => void room.controller.toggleScreenShare()}
              screenMode={room.controller.screenMode}
              onStartScreenShare={(mode) => void room.controller.startScreenShare(mode)}
              onScreenOptimize={(mode) => void room.controller.setScreenOptimize(mode)}
              onStopScreenShare={() => void room.controller.stopScreenShare()}
              canShareScreen={room.controller.canShareScreen}
              onCameraChange={(id) => {
                const deviceId = meetDeviceIdForOption(room.cameras, id);
                if (!deviceId) return;
                void room.controller.switchCamera(deviceId);
              }}
              onMicrophoneChange={(id) => {
                const deviceId = meetDeviceIdForOption(room.microphones, id);
                if (!deviceId) return;
                void room.controller.switchMic(deviceId);
              }}
              onSpeakerChange={room.onSpeakerChange}
              lowData={room.controller.lowData}
              onLowDataChange={room.controller.setLowData}
              // Members leave without ceremony (rejoining is one click); guests
              // and end-call-for-all keep the confirmation dialog.
              confirmExit={!room.hasSignedInIdentity || room.callExitLabel === meetLabels.endCall}
              onConfirmExit={() => {
                onLeave?.();
                void (room.callExitLabel === meetLabels.endCall
                  ? room.controller.endCallForAll()
                  : room.controller.leave());
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
