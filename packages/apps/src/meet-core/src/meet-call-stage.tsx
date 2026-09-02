import type { ReactNode } from "react";
import { MeetCallExpanded } from "@/meet-core/src/meet-call-expanded";
import {
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetRoomPaneProps } from "@/meet-core/src/meet-room-pane";
import { cn } from "@/lib/utils";

export type MeetCallStageRoomProps = Omit<
  MeetRoomPaneProps,
  "chatOpen" | "onToggleChat" | "hideChatToggle" | "statusEndActions"
>;

export type MeetCallStageProps = MeetCallStageRoomProps & {
  layout?: MeetCallStageLayout;
  chat?: ReactNode;
  channelTitle?: string;
  onLayoutChange?: (layout: MeetCallStageLayout) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  chatOpen?: boolean;
  defaultChatOpen?: boolean;
  onToggleChat?: () => void;
  className?: string;
};

export function MeetCallStage({
  layout = "side-by-side",
  chat,
  channelTitle,
  onLayoutChange,
  sidebarOpen,
  onToggleSidebar,
  chatOpen,
  defaultChatOpen,
  onToggleChat,
  className,
  ...room
}: MeetCallStageProps) {
  const showStage = meetCallStageShowsStage(layout);
  return (
    <div className={cn("meet-call-stage-host", className)}>
      <div
        className={cn(
          "meet-call-stage-host__stage",
          !showStage && "meet-workspace__surface--parked",
        )}
        inert={!showStage || undefined}
        aria-hidden={!showStage}
      >
        <MeetCallExpanded
          chat={chat}
          channelTitle={channelTitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          chatOpen={chatOpen}
          defaultChatOpen={defaultChatOpen}
          onToggleChat={onToggleChat}
          onCollapse={onLayoutChange ? () => onLayoutChange("compact") : undefined}
          onLeave={onLayoutChange ? () => onLayoutChange("collapsed") : undefined}
          {...room}
        />
      </div>
      <div
        className={cn(
          "meet-call-stage meet-call-stage--collapsed",
          showStage && "meet-workspace__surface--parked",
        )}
        inert={showStage || undefined}
        aria-hidden={showStage}
      >
        <div className="meet-call-stage__chat">
          {chat ?? (
            <div className="meet-call-stage__chat-placeholder">
              {meetLabels.chatColumnPlaceholder}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
