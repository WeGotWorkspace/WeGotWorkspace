import { useState, type ReactNode } from "react";
import { Video } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { ViewHeader } from "@/view-header/src/view-header";
import { defaultMeetWorkspacePanelOpen } from "@/meet-core/src/meet-call-chat-panel";
import { MeetCallStage, type MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { MeetLobbyPane, type MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-pane";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetWorkspaceRail } from "@/meet-core/src/meet-workspace-rail";
import { cn } from "@/lib/utils";
import "@/meet-core/src/meet-workspace.css";

export type MeetGuestChannelPhase = "checking" | "waiting" | "lobby" | "in-channel";

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
          inChannel ? (
            <MeetCallStage
              layout={callLayout}
              chat={showStage ? undefined : chat}
              channelTitle={channelName}
              chatOpen={chatOpen}
              onToggleChat={() => setChatOpen((open) => !open)}
              onLayoutChange={onLayoutChange}
              {...stage}
            />
          ) : (
            <div className="meet-guest-channel__lobby">
              <MeetLobbyPane
                {...lobby}
                inJoinFlow
                hasSignedInIdentity={false}
                showInviteCheckingScreen={phase === "checking" || lobby.showInviteCheckingScreen}
                showWaitingForHostScreen={phase === "waiting" || lobby.showWaitingForHostScreen}
              />
            </div>
          )
        }
      />
    </TooltipProvider>
  );
}
