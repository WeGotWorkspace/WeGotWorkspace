import type { ReactNode } from "react";
import { MessageSquare, Users } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { MeetKnockBadge } from "@/meet-core/src/meet-knock-badge";
import { MeetShareButton } from "@/meet-core/src/meet-share";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetKnocker = { id: string; name: string };

type MeetRoomStatusBarProps = {
  elapsedLabel: string;
  participantCount: number;
  callLink: string;
  knockers: MeetKnocker[];
  showKnockers: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  onCopyLink: () => void;
  onAdmitKnocker: (peerId: string) => void;
  onDenyKnocker: (peerId: string) => void;
  /** Hide the in-call chat drawer toggle (chat lives in the main column). */
  hideChatToggle?: boolean;
  /** Extra status-bar actions (e.g. expand / collapse the call stage). */
  endActions?: ReactNode;
};

export function MeetRoomStatusBar({
  elapsedLabel,
  participantCount,
  callLink,
  knockers,
  showKnockers,
  chatOpen,
  onToggleChat,
  onCopyLink,
  onAdmitKnocker,
  onDenyKnocker,
  hideChatToggle = false,
  endActions,
}: MeetRoomStatusBarProps) {
  return (
    <div className="meet-workspace__status-bar">
      <div className="flex items-center gap-3">
        <span className="meet-workspace__live-dot" />
        <span className="text-sm font-medium tabular-nums">{elapsedLabel}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="meet-workspace__participant-count">
              <Users className="size-3.5" />
              {participantCount}/4
            </span>
          </TooltipTrigger>
          <TooltipContent>{meetLabels.participantsTooltip(participantCount)}</TooltipContent>
        </Tooltip>
      </div>
      <div className="meet-workspace__status-actions">
        {showKnockers && knockers.length > 0 ? (
          <MeetKnockBadge knockers={knockers} onAdmit={onAdmitKnocker} onDeny={onDenyKnocker} />
        ) : null}
        <MeetShareButton link={callLink} onCopy={onCopyLink} />
        {hideChatToggle ? null : (
          <IconButton
            onClick={onToggleChat}
            icon={<MessageSquare />}
            label={chatOpen ? meetLabels.toggleChatHide : meetLabels.toggleChatShow}
            variant="subtle"
            active={chatOpen}
            className="hidden lg:inline-flex"
          />
        )}
        {endActions}
      </div>
    </div>
  );
}
