import type { ReactNode } from "react";
import { UserAvatar, type UserAvatarColor } from "@/user-avatar/src/user-avatar";
import { formatRelativeTimestamp } from "../docs-comments/docs-comments-utils";

export type DocsCollabCardHeaderProps = {
  authorName: string;
  /** Client-side colour per principal (suggestion cards). */
  authorColor?: UserAvatarColor;
  createdAt?: string;
  /** Overrides relative timestamp (e.g. calendar event when). */
  timeLabel?: string;
  actions: ReactNode;
};

export function DocsCollabCardHeader({
  authorName,
  authorColor,
  createdAt,
  timeLabel,
  actions,
}: DocsCollabCardHeaderProps) {
  const displayTime = timeLabel ?? (createdAt ? formatRelativeTimestamp(createdAt) : "");
  return (
    <div className="docs-collab-card__header">
      <div className="docs-collab-card__author-row">
        <UserAvatar
          displayName={authorName}
          color={authorColor}
          compact
          size="md"
          className="docs-collab-card__avatar"
        />
        <div className="docs-collab-card__meta">
          <p className="docs-collab-card__author">{authorName}</p>
          {displayTime ? (
            createdAt ? (
              <time className="docs-collab-card__time" dateTime={createdAt}>
                {displayTime}
              </time>
            ) : (
              <p className="docs-collab-card__time">{displayTime}</p>
            )
          ) : null}
        </div>
      </div>
      <div className="docs-collab-card__actions">{actions}</div>
    </div>
  );
}
