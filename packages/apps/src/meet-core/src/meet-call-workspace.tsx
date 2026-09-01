import { TooltipProvider } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import { MeetChatPane } from "@/meet-core/src/meet-chat-pane";
import { MeetLobbyPane } from "@/meet-core/src/meet-lobby-pane";
import { MeetRoomPane } from "@/meet-core/src/meet-room-pane";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { useDocumentTitle } from "@/lib/document-title";
import type { MeetCallWorkspaceProps } from "@/meet-core/src/meet-call-workspace-props";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import { useMeetWorkspaceShell } from "@/meet-core/src/use-meet-workspace-shell";
import "@/meet-core/src/meet-workspace.css";

export function MeetCallWorkspace({
  data,
  session,
  operations,
  invitedRoom = null,
  isJoinRoute = false,
  buildCallLink,
  onRoomChange,
  onLogout,
  className,
}: MeetCallWorkspaceProps) {
  const shell = useMeetWorkspaceShell({
    data,
    session,
    operations,
    invitedRoom,
    isJoinRoute,
    buildCallLink,
    onRoomChange,
  });

  const browserTitleContext = shell.inCall ? (shell.controller.roomCode ?? undefined) : "Meet";
  useDocumentTitle(browserTitleContext);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("meet-workspace", shell.inCall && "meet-workspace--in-call", className)}>
        <WorkspaceShellHeader
          session={shell.session}
          displayName={shell.displayName}
          appSwitchDisabled={shell.header.disableAppSwitcher}
          showUserAccount={shell.header.showUserAccount}
          onLogout={onLogout}
        />

        {!shell.inCall ? (
          <main className="meet-workspace__lobby">
            <MeetLobbyPane
              controller={shell.controller}
              displayName={shell.displayName}
              {...shell.lobby}
            />
          </main>
        ) : (
          <main
            className={cn(
              "meet-workspace__room",
              shell.chat.chatOpen
                ? "meet-workspace__room--chat-open"
                : "meet-workspace__room--chat-closed",
            )}
          >
            <MeetRoomPane
              controller={shell.controller}
              displayName={shell.displayName}
              {...shell.room}
            />
            {shell.chat.chatOpen ? (
              <>
                <button
                  type="button"
                  className="meet-workspace__chat-scrim"
                  aria-label={meetLabels.toggleChatHide}
                  onClick={shell.chat.onClose}
                />
                <MeetChatPane
                  messages={shell.controller.chatMessages}
                  draft={shell.chat.draft}
                  onDraftChange={shell.chat.onDraftChange}
                  onSend={shell.chat.onSend}
                  onClose={shell.chat.onClose}
                />
              </>
            ) : null}
          </main>
        )}
      </div>
    </TooltipProvider>
  );
}
