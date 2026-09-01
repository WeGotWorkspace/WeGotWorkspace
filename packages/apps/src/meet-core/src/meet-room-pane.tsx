import type { ReactNode } from "react";
import { MonitorUp } from "lucide-react";
import { MeetCallToolbar } from "@/meet-core/src/meet-call-toolbar";
import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import { MeetRoomStatusBar } from "@/meet-core/src/meet-room-status-bar";
import { MeetSelfPreviewPiP } from "@/meet-core/src/meet-self-preview-pip";
import { MeetShareInline } from "@/meet-core/src/meet-share";
import { MeetStreamVideo } from "@/meet-core/src/meet-stream-video";
import { cn } from "@/lib/utils";

export type MeetRoomPaneProps = {
  controller: MeetControllerState;
  displayName: string;
  hasSignedInIdentity: boolean;
  participantCount: number;
  chatOpen: boolean;
  onToggleChat: () => void;
  callExitLabel: string;
  callExitTitle: string;
  callExitDescription: string;
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
  onSpeakerChange: (value: string) => void;
  onCopyLink: () => void;
  onMuteSoon: (name: string) => void;
  onToastInfo: (message: string) => void;
  onToastError: (message: string) => void;
  hideChatToggle?: boolean;
  statusEndActions?: ReactNode;
};

function peerGridClass(count: number) {
  if (count <= 1) return "meet-workspace__peer-grid--1";
  if (count === 2) return "meet-workspace__peer-grid--2";
  return "meet-workspace__peer-grid--4";
}

export function MeetRoomPane({
  controller,
  displayName,
  hasSignedInIdentity,
  participantCount,
  chatOpen,
  onToggleChat,
  callExitLabel,
  callExitTitle,
  callExitDescription,
  cameras,
  microphones,
  speakers,
  activeCamera,
  activeMic,
  activeSpeaker,
  onSpeakerChange,
  onCopyLink,
  onMuteSoon,
  onToastInfo,
  onToastError,
  hideChatToggle = false,
  statusEndActions,
}: MeetRoomPaneProps) {
  const sharing = controller.screenOn;

  return (
    <div className="meet-workspace__room-main">
      <MeetRoomStatusBar
        elapsedLabel={controller.elapsedLabel}
        participantCount={participantCount}
        callLink={controller.callLink}
        knockers={controller.knockers}
        showKnockers={hasSignedInIdentity}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
        onCopyLink={onCopyLink}
        onAdmitKnocker={(peerId) => void controller.admitKnocker(peerId)}
        onDenyKnocker={(peerId) => void controller.denyKnocker(peerId)}
        hideChatToggle={hideChatToggle}
        endActions={statusEndActions}
      />

      <div className="meet-workspace__stage">
        <div className="meet-workspace__stage-inner">
          {sharing ? (
            <div className="meet-workspace__share-layout">
              <div className="meet-workspace__screen-stage">
                {controller.screenPreviewStream ? (
                  <MeetStreamVideo
                    stream={controller.screenPreviewStream}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="meet-workspace__muted flex h-full items-center justify-center text-sm">
                    <MonitorUp className="mr-2 size-4" /> {meetLabels.sharingScreen}
                  </div>
                )}
                <div className="meet-workspace__presenting-badge">{meetLabels.presenting}</div>
              </div>
              {controller.peers.length > 0 ? (
                <div className="meet-workspace__peer-strip">
                  {controller.peers.map((peer) => (
                    <MeetPeerTile
                      key={peer.id}
                      name={peer.name}
                      stream={peer.stream}
                      compact
                      remoteMedia={peer.remoteMedia}
                      disclosedMedia={peer.disclosedMedia}
                      onMuteSoon={onMuteSoon}
                    />
                  ))}
                </div>
              ) : (
                <div className="meet-workspace__empty-stage">
                  <span>{meetLabels.waitingForOthers}</span>
                  <MeetShareInline link={controller.callLink} onCopy={onCopyLink} />
                </div>
              )}
            </div>
          ) : controller.peers.length > 0 ? (
            <div
              className={cn("meet-workspace__peer-grid", peerGridClass(controller.peers.length))}
            >
              {controller.peers.map((peer) => (
                <MeetPeerTile
                  key={peer.id}
                  name={peer.name}
                  stream={peer.stream}
                  remoteMedia={peer.remoteMedia}
                  disclosedMedia={peer.disclosedMedia}
                  onMuteSoon={onMuteSoon}
                />
              ))}
            </div>
          ) : (
            <div className="meet-workspace__empty-stage h-full">
              <span>{meetLabels.waitingForOthers}</span>
              <MeetShareInline link={controller.callLink} onCopy={onCopyLink} />
            </div>
          )}

          <MeetSelfPreviewPiP
            name={displayName}
            videoOn={controller.videoOn}
            micOn={controller.micOn}
            videoRef={controller.localVideoRef}
            onInfo={onToastInfo}
            onError={onToastError}
          />
        </div>
      </div>

      <MeetCallToolbar
        micOn={controller.micOn}
        videoOn={controller.videoOn}
        screenOn={controller.screenOn}
        callExitLabel={callExitLabel}
        callExitTitle={callExitTitle}
        callExitDescription={callExitDescription}
        cameras={cameras}
        microphones={microphones}
        speakers={speakers}
        activeCamera={activeCamera}
        activeMic={activeMic}
        activeSpeaker={activeSpeaker}
        onToggleMic={controller.toggleMic}
        onToggleVideo={controller.toggleVideo}
        onToggleScreenShare={() => void controller.toggleScreenShare()}
        onCameraChange={(id) => {
          const deviceId = meetDeviceIdForOption(cameras, id);
          if (!deviceId) return;
          void controller.switchCamera(deviceId);
        }}
        onMicrophoneChange={(id) => {
          const deviceId = meetDeviceIdForOption(microphones, id);
          if (!deviceId) return;
          void controller.switchMic(deviceId);
        }}
        onSpeakerChange={onSpeakerChange}
        onConfirmExit={() =>
          void (callExitLabel === meetLabels.endCall
            ? controller.endCallForAll()
            : controller.leave())
        }
      />
    </div>
  );
}
