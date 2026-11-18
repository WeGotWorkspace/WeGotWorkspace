import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { formatNotificationCopy } from "@/notifications-core/src/format-notification-copy";
import {
  notificationInboxAppId,
  notificationInboxDomainLabel,
} from "@/notifications-core/src/notification-inbox-row-meta";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import "@/notifications-core/src/notification-item.css";

function actorKey(item: NotificationInboxItem, actor: string): string {
  const username = item.data?.actorUsername;
  return typeof username === "string" && username.trim() !== "" ? username : actor;
}

/**
 * Who + where: the actor's avatar with the app icon as a corner badge.
 * An item without an actor (a reminder) shows the app icon on its own.
 */
function NotificationItemMark({
  appId,
  domain,
  actor,
  actorKey: key,
}: {
  appId: WorkspaceAppId;
  domain: string;
  actor: string | null;
  actorKey: string;
}) {
  if (actor == null) {
    return (
      <span className="notification-item__mark" title={domain} aria-hidden>
        <WorkspaceAppIcon appId={appId} className="notification-item__app-icon" />
      </span>
    );
  }
  return (
    <span className="notification-item__mark" title={domain} aria-hidden>
      <UserAvatar
        displayName={actor}
        compact
        size="xl"
        color={avatarColorForUserId(key)}
        className="notification-item__avatar"
      />
      <span className="notification-item__app-badge">
        <WorkspaceAppIcon appId={appId} className="notification-item__app-badge-icon" />
      </span>
    </span>
  );
}

export type NotificationItemContentProps = {
  item: NotificationInboxItem;
  /** Read out before the title (the tray's "Unread."). */
  srPrefix?: string;
};

/**
 * One notification, the same wherever it shows: the mark (actor avatar + app
 * badge), the title with the actor in bold, and a two-line body. The inbox tray
 * row and the toast both render this; each adds only its own frame and controls
 * (the tray's unread dot, time and "Mark as read"; the toast's frosted surface).
 */
export function NotificationItemContent({ item, srPrefix }: NotificationItemContentProps) {
  const appId = notificationInboxAppId(item);
  const domain = notificationInboxDomainLabel(appId);
  const { title, titleActor, titleRest, body } = formatNotificationCopy(item);
  const hasActor = titleActor != null && titleRest != null;

  return (
    <>
      <NotificationItemMark
        appId={appId}
        domain={domain}
        actor={hasActor ? titleActor : null}
        actorKey={hasActor ? actorKey(item, titleActor) : ""}
      />
      <span className="notification-item__main">
        <span
          className={
            hasActor
              ? "notification-item__title"
              : "notification-item__title notification-item__title--plain"
          }
        >
          {srPrefix ? <span className="sr-only">{srPrefix} </span> : null}
          {hasActor ? (
            <>
              <strong className="notification-item__actor">{titleActor}</strong>
              <span className="notification-item__rest">{titleRest}</span>
            </>
          ) : (
            title
          )}
          <span className="sr-only">, {domain}</span>
        </span>
        {body ? <span className="notification-item__body">{body}</span> : null}
      </span>
    </>
  );
}
