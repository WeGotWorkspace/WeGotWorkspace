import { Send, MessageSquare, X } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Input } from "@/ui/input";
import { formatMeetChatTime, renderMeetChatBody } from "@/meet-core/src/meet-chat-utils";
import { meetLabels } from "@/meet-core/src/meet-labels";

export type MeetChatMessage = {
  id: string;
  fromName: string;
  body: string;
  ts: number;
  isSelf?: boolean;
};

type MeetChatPaneProps = {
  messages: MeetChatMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
};

export function MeetChatPane({
  messages,
  draft,
  onDraftChange,
  onSend,
  onClose,
}: MeetChatPaneProps) {
  return (
    <aside className="meet-chat">
      <div className="meet-chat__header">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="size-4" /> {meetLabels.chatTitle}
        </div>
        <IconButton
          onClick={onClose}
          icon={<X />}
          label={meetLabels.toggleChatHide}
          size="sm"
          variant="subtle"
          showTooltip={false}
        />
      </div>
      <div className="meet-chat__messages">
        {messages.length === 0 && <div className="meet-chat__empty">{meetLabels.chatEmpty}</div>}
        {messages.map((message) => (
          <div key={message.id} className="space-y-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold">
                {message.isSelf ? meetLabels.youLabel : message.fromName}
              </span>
              <span className="meet-chat__time">{formatMeetChatTime(message.ts)}</span>
            </div>
            <div className="meet-chat__bubble">{renderMeetChatBody(message.body)}</div>
          </div>
        ))}
      </div>
      <div className="meet-chat__composer">
        <div className="flex items-center gap-2">
          <Input
            placeholder={meetLabels.chatPlaceholder}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSend();
            }}
            className="meet-chat__input"
          />
          <IconButton
            onClick={onSend}
            icon={<Send />}
            label={meetLabels.sendMessage}
            variant="subtle"
            showTooltip={false}
          />
        </div>
      </div>
    </aside>
  );
}
