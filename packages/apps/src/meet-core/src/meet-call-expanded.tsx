import { type ReactNode, useCallback, useState } from "react";
import { MessageSquare, Minimize2, Video } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { meetCallBarMeta } from "@/meet-core/src/meet-call-bar";
import { MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { defaultMeetCallChatOpen } from "@/meet-core/src/meet-call-chat-panel";
import {
  meetCallGivenName,
  meetCallPeerCameraOn,
  meetCallPeerScreenSharing,
  meetCallStripPeers,
  pickMeetCallSpotlight,
  type MeetCallSpotlightPeer,
} from "@/meet-core/src/meet-call-spotlight";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import { MeetCallToolbar } from "@/meet-core/src/meet-call-toolbar";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import { MeetStreamVideo } from "@/meet-core/src/meet-stream-video";
import { cn } from "@/lib/utils";
import { WorkspaceSidebarToggle } from "@/workspace-shell/src/workspace-app-layout";

export type MeetCallExpandedProps = MeetCallStageRoomProps & {
  chat?: ReactNode;
  channelTitle?: string;
  onCollapse?: () => void;
  onLeave?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  chatOpen?: boolean;
  defaultChatOpen?: boolean;
  onToggleChat?: () => void;
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

function tileCaption(
  peer: MeetCallSpotlightPeer,
  isSelf: boolean,
  videoOn: boolean,
): string | undefined {
  if (!isSelf && meetCallPeerScreenSharing(peer)) return meetLabels.presenting;
  if (isSelf && videoOn && !peer.stream) return meetLabels.startingCamera;
  if (!meetCallPeerCameraOn(peer)) return meetLabels.camerasOffAudioOnly;
  return undefined;
}

function MeetCallChatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      onClick={onToggle}
      icon={<MessageSquare />}
      label={open ? meetLabels.toggleChatHide : meetLabels.toggleChatShow}
      size="sm"
      variant="subtle"
      active={open}
      aria-pressed={open}
    />
  );
}

export function MeetCallExpanded({
  chat: _chat,
  channelTitle,
  onCollapse,
  onLeave,
  sidebarOpen = false,
  onToggleSidebar,
  chatOpen: chatOpenProp,
  defaultChatOpen,
  onToggleChat,
  className,
  ...room
}: MeetCallExpandedProps) {
  const [uncontrolledChatOpen, setUncontrolledChatOpen] = useState(
    () => defaultChatOpen ?? defaultMeetCallChatOpen(),
  );
  const chatOpen = chatOpenProp ?? uncontrolledChatOpen;
  const toggleChat = useCallback(() => {
    onToggleChat?.();
    if (chatOpenProp === undefined) setUncontrolledChatOpen((open) => !open);
  }, [chatOpenProp, onToggleChat]);
  const self = selfPeer(room);
  const remotes = room.controller.peers;
  const sharing = room.controller.screenOn;
  // Chunk-I knock chrome: knocker-side wait state on the stage; member-side
  // admit/deny lives on the action-row icon (guests never moderate knocks).
  const waitingForAdmission = room.controller.waitingForAdmission;
  const knockers = room.hasSignedInIdentity && !waitingForAdmission ? room.controller.knockers : [];
  const cancelKnock = useCallback(() => {
    onLeave?.();
    void room.controller.leave();
    // Both paths reset the same session state; the double leave is idempotent.
  }, [onLeave, room.controller]);
  const spotlight = sharing
    ? {
        id: "screen",
        name: meetLabels.presenting,
        stream: room.controller.screenPreviewStream,
        disclosedMedia: { camera: true, mic: true, screen: true },
      }
    : pickMeetCallSpotlight(remotes, self);
  const strip = meetCallStripPeers(spotlight, remotes, self);
  const title = channelTitle ? meetLabels.meetInChannel(channelTitle) : meetLabels.productName;
  const collapseButton = onCollapse ? (
    <IconButton
      onClick={onCollapse}
      icon={<Minimize2 />}
      label={meetLabels.collapseCall}
      size="sm"
      variant="subtle"
    />
  ) : null;

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
              <span className="meet-call-stage__mark" aria-hidden>
                <Video className="meet-workspace__header-kind-icon" />
              </span>
              <div className="meet-call-stage__copy">
                <h2 className="meet-call-stage__title">{title}</h2>
                <p className="meet-call-stage__meta">
                  {meetCallBarMeta(room.participantCount, room.controller.elapsedLabel)}
                </p>
              </div>
            </div>
          </div>
          <div className="meet-call-stage__header-actions">
            {collapseButton}
            <MeetCallChatToggle open={chatOpen} onToggle={toggleChat} />
          </div>
        </header>

        {waitingForAdmission ? (
          <div className="meet-call-stage__body">
            <MeetCallKnockWaiting
              variant="stage"
              channelTitle={channelTitle}
              onCancel={cancelKnock}
            />
          </div>
        ) : (
          <div className="meet-call-stage__body">
            <div className="meet-call-stage__spotlight">
              {sharing && !room.controller.screenPreviewStream ? (
                <div className="meet-call-stage__screen-fallback">{meetLabels.sharingScreen}</div>
              ) : sharing && room.controller.screenPreviewStream ? (
                <MeetStreamVideo
                  stream={room.controller.screenPreviewStream}
                  muted
                  className="meet-call-stage__screen"
                />
              ) : (
                <MeetPeerTile
                  name={spotlight.name}
                  stream={spotlight.stream ?? null}
                  userId={spotlight.id}
                  muted={spotlight.id === self.id}
                  spotlight
                  speaking={
                    !sharing && spotlight.id !== self.id && !meetCallPeerScreenSharing(spotlight)
                  }
                  caption={tileCaption(
                    spotlight,
                    spotlight.id === self.id,
                    room.controller.videoOn,
                  )}
                  remoteMedia={spotlight.remoteMedia}
                  disclosedMedia={spotlight.disclosedMedia}
                  micOn={spotlight.id === self.id ? room.controller.micOn : undefined}
                  onToggleMic={spotlight.id === self.id ? room.controller.toggleMic : undefined}
                  onMuteParticipant={
                    spotlight.id === self.id || !room.hasSignedInIdentity
                      ? undefined
                      : (muted) => void room.controller.mutePeer(spotlight.id, muted)
                  }
                />
              )}
            </div>
            <ul className="meet-call-stage__strip">
              {strip.map((peer) => {
                const isSelf = peer.id === self.id;
                return (
                  <li key={peer.id} className="meet-call-stage__strip-item">
                    <MeetPeerTile
                      name={peer.name}
                      stream={peer.stream ?? null}
                      userId={peer.id}
                      muted={isSelf}
                      compact
                      caption={
                        isSelf && room.controller.videoOn && !peer.stream
                          ? meetLabels.startingCamera
                          : undefined
                      }
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
                    />
                    <p className="meet-call-stage__strip-caption">
                      {isSelf ? meetLabels.youLabel : meetCallGivenName(peer.name)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
            onToggleScreenShare={() => void room.controller.toggleScreenShare()}
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
            knockers={knockers}
            onAdmitKnocker={(peerId) => void room.controller.admitKnocker(peerId)}
            onDenyKnocker={(peerId) => void room.controller.denyKnocker(peerId)}
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
      </div>
    </div>
  );
}
