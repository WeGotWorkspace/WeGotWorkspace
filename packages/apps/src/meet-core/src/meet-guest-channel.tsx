import { useEffect, useState, type ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { Button } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
import { MeetDeviceForm } from "@/meet-core/src/meet-device-form";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-pane";
import { MeetLobbyStatusCard } from "@/meet-core/src/meet-lobby-status-card";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import { cn } from "@/lib/utils";
import "@/meet-core/src/meet-workspace.css";

export type MeetGuestChannelPhase =
  | "checking"
  | "waiting"
  | "missing"
  | "error"
  | "ended"
  | "lobby"
  | "knocking"
  | "in-channel";

export type MeetGuestChannelProps = {
  channelName: string;
  phase: MeetGuestChannelPhase;
  lobby: MeetLobbyPaneProps;
  stage: MeetCallStageRoomProps;
  callLayout?: MeetCallStageLayout;
  chat?: ReactNode;
  onLayoutChange?: (layout: MeetCallStageLayout) => void;
  className?: string;
};

export type MeetGuestChannelFrameProps = {
  channelName: string;
  children: ReactNode;
  className?: string;
};

export function meetGuestChannelPhase(input: {
  inCall: boolean;
  showInviteCheckingScreen: boolean;
  showWaitingForHostScreen: boolean;
  showMissingInviteScreen: boolean;
  showInviteErrorScreen: boolean;
  endedMessage: string | null;
  waitingForAdmission: boolean;
}): MeetGuestChannelPhase {
  if (input.inCall) return "in-channel";
  if (input.endedMessage) return "ended";
  if (input.showInviteCheckingScreen) return "checking";
  if (input.showMissingInviteScreen) return "missing";
  if (input.showInviteErrorScreen) return "error";
  if (input.showWaitingForHostScreen) return "waiting";
  if (input.waitingForAdmission) return "knocking";
  return "lobby";
}

/** Split chrome (ViewHeader, cream/dusk) for invite states that have no RTC controller yet. */
export function MeetGuestChannelFrame({
  channelName,
  children,
  className,
}: MeetGuestChannelFrameProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn("meet-workspace meet-workspace--split meet-guest-channel", className)}
        sidebar={null}
        mainHeader={
          <ViewHeader
            hideSidebarToggle
            title={channelName}
            titlePrefix={<Video className="meet-workspace__header-kind-icon" aria-hidden />}
          />
        }
        main={<div className="meet-guest-channel__lobby">{children}</div>}
      />
    </TooltipProvider>
  );
}

export function MeetGuestChannel({
  channelName,
  phase,
  lobby,
  stage,
  callLayout = "side-by-side",
  chat,
  onLayoutChange,
  className,
}: MeetGuestChannelProps) {
  const inChannel = phase === "in-channel";
  const showStage = inChannel && meetCallStageShowsStage(callLayout);
  const [chatOpen, setChatOpen] = useState(defaultMeetWorkspacePanelOpen);
  const chatTitle = meetLabels.chatInChannel(channelName);

  if (!inChannel) {
    return (
      <MeetGuestChannelFrame channelName={channelName} className={className}>
        <MeetGuestLobby
          {...lobby}
          channelName={channelName}
          inJoinFlow
          showInviteCheckingScreen={phase === "checking" || lobby.showInviteCheckingScreen}
          showWaitingForHostScreen={phase === "waiting" || lobby.showWaitingForHostScreen}
          showMissingInviteScreen={phase === "missing" || lobby.showMissingInviteScreen}
          showInviteErrorScreen={phase === "error" || lobby.showInviteErrorScreen}
          endedMessage={
            phase === "ended"
              ? (lobby.endedMessage ?? "The host ended the meeting for everyone.")
              : lobby.endedMessage
          }
          waitingForAdmission={phase === "knocking" || lobby.waitingForAdmission}
        />
      </MeetGuestChannelFrame>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn(
          "meet-workspace meet-workspace--split meet-guest-channel",
          showStage && "meet-workspace--call-active",
          className,
        )}
        sidebar={null}
        panel={
          <MeetWorkspaceRail
            open={showStage && chatOpen}
            title={chatTitle}
            closeLabel={meetLabels.chatClose}
            onClose={() => setChatOpen(false)}
          >
            {chat}
          </MeetWorkspaceRail>
        }
        mainHeader={
          showStage ? undefined : (
            <ViewHeader
              hideSidebarToggle
              title={channelName}
              titlePrefix={<Video className="meet-workspace__header-kind-icon" aria-hidden />}
            />
          )
        }
        main={
          <MeetCallStage
            layout={callLayout}
            chat={showStage ? undefined : chat}
            channelTitle={channelName}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((open) => !open)}
            onLayoutChange={onLayoutChange}
            {...stage}
          />
        }
      />
    </TooltipProvider>
  );
}

function MeetGuestLobby({
  controller,
  displayName,
  hasSignedInIdentity,
  invitedRoom,
  waitingForAdmission,
  cameras,
  microphones,
  speakers,
  activeCamera,
  activeMic,
  activeSpeaker,
  onSpeakerChange,
  endedMessage,
  showMissingInviteScreen,
  showInviteCheckingScreen,
  showWaitingForHostScreen,
  showInviteErrorScreen,
  canStartReservedRoom,
  displayNameLocked = false,
  channelName,
}: MeetLobbyPaneProps & { channelName: string }) {
  const [previewAspect, setPreviewAspect] = useState<number | null>(null);

  useEffect(() => {
    const video = controller.localVideoRef.current;
    if (!video || !controller.videoOn) {
      setPreviewAspect(null);
      return;
    }
    const update = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      setPreviewAspect(w > 0 && h > 0 ? w / h : null);
    };
    update();
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [controller.videoOn, controller.localVideoRef]);

  if (endedMessage) {
    return (
      <MeetLobbyStatusCard title={meetLabels.callEndedTitle} body={endedMessage} titleSize="lg" />
    );
  }

  if (showMissingInviteScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.missingInviteTitle}
        body={meetLabels.missingInviteBody}
      />
    );
  }

  if (showInviteCheckingScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.checkingInviteTitle}
        body={meetLabels.checkingInviteBody}
        titleSize="md"
      />
    );
  }

  if (showWaitingForHostScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.waitingForHostTitle}
        body={meetLabels.waitingForHostBody}
      />
    );
  }

  if (showInviteErrorScreen) {
    return (
      <MeetLobbyStatusCard title={meetLabels.inviteErrorTitle} body={meetLabels.inviteErrorBody} />
    );
  }

  if (waitingForAdmission) {
    return (
      <MeetCallKnockWaiting
        variant="stage"
        channelTitle={channelName}
        onCancel={() => void controller.leave()}
      />
    );
  }

  return (
    <div className="meet-guest-channel__lobby-join">
      <h1 className="meet-guest-channel__lobby-title">{meetLabels.lobbyJoinTitle}</h1>
      <div
        className="meet-workspace__preview"
        style={
          previewAspect != null && controller.videoOn ? { aspectRatio: previewAspect } : undefined
        }
      >
        {controller.videoOn ? (
          <video
            ref={controller.localVideoRef}
            autoPlay
            muted
            playsInline
            className="meet-workspace__preview-video"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <UserAvatar displayName={displayName} compact size="xl" />
          </div>
        )}
        <div className="meet-workspace__preview-controls">
          <MeetCircleToggle
            on={controller.micOn}
            onClick={controller.toggleMic}
            OnIcon={Mic}
            OffIcon={MicOff}
            label={controller.micOn ? "Mute" : "Unmute"}
          />
          <MeetCircleToggle
            on={controller.videoOn}
            onClick={controller.toggleVideo}
            OnIcon={Video}
            OffIcon={VideoOff}
            label={controller.videoOn ? "Stop video" : "Start video"}
          />
        </div>
      </div>
      <MeetDeviceForm
        displayName={{
          value: controller.displayName,
          onChange: displayNameLocked ? () => undefined : controller.setDisplayName,
          disabled: displayNameLocked,
        }}
        cameras={cameras}
        microphones={microphones}
        speakers={speakers}
        camera={activeCamera}
        microphone={activeMic}
        speaker={activeSpeaker}
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
        menuClassName="meet-device-popover"
      >
        <Button
          variant="primary"
          pill
          onClick={() => {
            if (invitedRoom) {
              void (canStartReservedRoom
                ? controller.joinRoom(invitedRoom)
                : controller.requestJoin(invitedRoom));
              return;
            }
            if (!hasSignedInIdentity) return;
            void controller.startMeeting();
          }}
          className="meet-workspace__primary-button"
          disabled={!hasSignedInIdentity && !invitedRoom}
        >
          {invitedRoom
            ? canStartReservedRoom
              ? meetLabels.joinMeeting
              : meetLabels.askToJoin
            : hasSignedInIdentity
              ? meetLabels.startMeeting
              : meetLabels.inviteRequired}
        </Button>
        {controller.error ? <p className="meet-workspace__error">{controller.error}</p> : null}
      </MeetDeviceForm>
    </div>
  );
}
