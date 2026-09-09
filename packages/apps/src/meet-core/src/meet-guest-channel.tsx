import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { MeetGuestLobby } from "@/meet-core/src/meet-guest-lobby";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-props";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannelKind } from "@/meet-core/src/meet-types";
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
  channelTopic?: string | null;
  channelKind?: MeetChannelKind;
  phase: MeetGuestChannelPhase;
  lobby: MeetLobbyPaneProps;
  stage: MeetCallStageRoomProps;
  callLayout?: MeetCallStageLayout;
  chat?: ReactNode;
  className?: string;
};

export type MeetGuestChannelFrameProps = {
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
  // Knock wait stays on the invite card. `requestJoin` also sets inCall via
  // `preparing`; checking inCall first flashed MeetCallKnockWaiting.
  if (input.waitingForAdmission) return "knocking";
  if (input.inCall) return "in-channel";
  if (input.endedMessage) return "ended";
  if (input.showInviteCheckingScreen) return "checking";
  if (input.showMissingInviteScreen) return "missing";
  if (input.showInviteErrorScreen) return "error";
  if (input.showWaitingForHostScreen) return "waiting";
  return "lobby";
}

/**
 * Guests have no signed-in chat column behind the stage. Compact/collapsed
 * would park the call and leave only the navy chat strip.
 */
export function meetGuestChannelStageLayout(layout: MeetCallStageLayout): MeetCallStageLayout {
  return meetCallStageShowsStage(layout) ? layout : "side-by-side";
}

/** Cream/dusk invite chrome without ViewHeader — the card is preview + invite only. */
export function MeetGuestChannelFrame({ children, className }: MeetGuestChannelFrameProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <WorkspaceAppLayout
        className={cn("meet-workspace meet-workspace--split meet-guest-channel", className)}
        sidebar={null}
        main={
          <div
            className="meet-guest-channel__lobby"
            tabIndex={0}
            aria-label={meetLabels.guestLobbyRegion}
          >
            {children}
          </div>
        }
      />
    </TooltipProvider>
  );
}

export function MeetGuestChannel({
  channelName,
  channelTopic,
  channelKind,
  phase,
  lobby,
  stage,
  callLayout = "side-by-side",
  chat,
  className,
}: MeetGuestChannelProps) {
  const knocking = phase === "knocking" || lobby.waitingForAdmission;
  const inChannel = phase === "in-channel" && !knocking;
  const stageLayout = meetGuestChannelStageLayout(callLayout);
  const showStage = inChannel;
  const [chatOpen, setChatOpen] = useState(defaultMeetWorkspacePanelOpen);
  const chatTitle = meetLabels.chatInChannel(channelName);

  if (!inChannel) {
    return (
      <MeetGuestChannelFrame className={className}>
        <MeetGuestLobby
          {...lobby}
          channelName={channelName}
          channelTopic={channelTopic}
          channelKind={channelKind}
          showInviteCheckingScreen={phase === "checking" || lobby.showInviteCheckingScreen}
          showWaitingForHostScreen={phase === "waiting" || lobby.showWaitingForHostScreen}
          showMissingInviteScreen={phase === "missing" || lobby.showMissingInviteScreen}
          showInviteErrorScreen={phase === "error" || lobby.showInviteErrorScreen}
          endedMessage={
            phase === "ended"
              ? (lobby.endedMessage ?? "The host ended the meeting for everyone.")
              : lobby.endedMessage
          }
          waitingForAdmission={knocking}
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
        main={
          <MeetCallStage
            layout={stageLayout}
            channelTitle={channelName}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((open) => !open)}
            {...stage}
          />
        }
      />
    </TooltipProvider>
  );
}
