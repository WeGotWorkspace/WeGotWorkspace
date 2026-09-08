import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import type { ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { filterChatMentionPrincipals } from "@/chat-ui/src/chat-mention-utils";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-mention-menu.css";

export type ChatMentionMenuProps = {
  principals: readonly ChatMentionPrincipal[];
  query?: string;
  open?: boolean;
  activeIndex?: number;
  onSelect: (principal: ChatMentionPrincipal) => void;
  className?: string;
};

export function ChatMentionMenu({
  principals,
  query = "",
  open = true,
  activeIndex = 0,
  onSelect,
  className,
}: ChatMentionMenuProps) {
  if (!open) return null;

  const matches = filterChatMentionPrincipals(principals, query);

  return (
    <div className={cn("chat-mention-menu", className)}>
      {matches.length === 0 ? (
        <div className="chat-mention-menu__empty">{chatUiLabels.mentionEmpty}</div>
      ) : (
        <div
          className="chat-mention-menu__list"
          role="listbox"
          aria-label={chatUiLabels.mentionList}
        >
          {matches.map((principal, index) => (
            <button
              key={principal.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex ? "true" : "false"}
              className="chat-mention-menu__option"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(principal);
              }}
            >
              <UserAvatar
                displayName={principal.displayName}
                compact
                size="sm"
                color={avatarColorForUserId(principal.id)}
              />
              <span className="chat-mention-menu__name">{principal.displayName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
