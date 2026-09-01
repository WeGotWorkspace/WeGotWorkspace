import type { ReactNode } from "react";
import { Maximize2, Minimize2, PanelRightClose } from "lucide-react";
import { IconButton } from "@/button/src/button";
import {
  meetCallStageShowsChat,
  meetCallStageShowsStage,
  type MeetCallStageLayout,
} from "@/meet-core/src/meet-call-stage-layout";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetRoomPane, type MeetRoomPaneProps } from "@/meet-core/src/meet-room-pane";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/ui/resizable";
import { cn } from "@/lib/utils";

const noop = () => {};

export type MeetCallStageRoomProps = Omit<
  MeetRoomPaneProps,
  "chatOpen" | "onToggleChat" | "hideChatToggle" | "statusEndActions"
>;

export type MeetCallStageProps = MeetCallStageRoomProps & {
  layout?: MeetCallStageLayout;
  chat?: ReactNode;
  onLayoutChange?: (layout: MeetCallStageLayout) => void;
  className?: string;
};

function MeetCallStageLayoutActions({
  layout,
  onLayoutChange,
}: {
  layout: MeetCallStageLayout;
  onLayoutChange: (layout: MeetCallStageLayout) => void;
}) {
  if (layout === "collapsed") return null;
  return (
    <>
      {layout === "side-by-side" ? (
        <IconButton
          onClick={() => onLayoutChange("fullscreen")}
          icon={<Maximize2 />}
          label={meetLabels.expandCall}
          variant="subtle"
        />
      ) : (
        <IconButton
          onClick={() => onLayoutChange("side-by-side")}
          icon={<Minimize2 />}
          label={meetLabels.restoreCall}
          variant="subtle"
        />
      )}
      <IconButton
        onClick={() => onLayoutChange("collapsed")}
        icon={<PanelRightClose />}
        label={meetLabels.collapseCall}
        variant="subtle"
      />
    </>
  );
}

export function MeetCallStage({
  layout = "side-by-side",
  chat,
  onLayoutChange,
  className,
  ...room
}: MeetCallStageProps) {
  const showChat = meetCallStageShowsChat(layout);
  const showStage = meetCallStageShowsStage(layout);
  const chatColumn = (
    <div className="meet-call-stage__chat">
      {chat ?? (
        <div className="meet-call-stage__chat-placeholder">{meetLabels.chatColumnPlaceholder}</div>
      )}
    </div>
  );

  const stage = (
    <div className="meet-call-stage__stage">
      <div className="meet-workspace__room meet-workspace__room--chat-closed">
        <MeetRoomPane
          {...room}
          chatOpen={false}
          onToggleChat={noop}
          hideChatToggle
          statusEndActions={
            onLayoutChange ? (
              <MeetCallStageLayoutActions layout={layout} onLayoutChange={onLayoutChange} />
            ) : null
          }
        />
      </div>
    </div>
  );

  if (showChat && showStage) {
    return (
      <div className={cn("meet-call-stage meet-call-stage--split", className)}>
        <ResizablePanelGroup className="meet-call-split__group" orientation="horizontal">
          <ResizablePanel className="meet-call-split__chat" defaultSize={58} minSize={28}>
            {chatColumn}
          </ResizablePanel>
          <ResizableHandle
            className="meet-call-split__handle"
            withHandle
            aria-label={meetLabels.resizeCall}
          />
          <ResizablePanel className="meet-call-split__stage" defaultSize={42} minSize={24}>
            {stage}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  if (showStage) {
    return (
      <div className={cn("meet-call-stage meet-call-stage--fullscreen", className)}>{stage}</div>
    );
  }

  return (
    <div className={cn("meet-call-stage meet-call-stage--collapsed", className)}>{chatColumn}</div>
  );
}
