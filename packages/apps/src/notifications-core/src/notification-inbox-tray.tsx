import { Bell, BellOff, BellRing, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import {
  formatNotificationRelativeTime,
  notificationInboxAppId,
  notificationInboxDomainLabel,
} from "@/notifications-core/src/notification-inbox-row-meta";
import { formatNotificationCopy } from "@/notifications-core/src/format-notification-copy";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { useInboxBadgePulseAttr } from "@/lib/notifications/use-inbox-badge-pulse";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import "@/notifications-core/src/notification-inbox-tray.css";

export type NotificationInboxTrayProps = {
  items: readonly NotificationInboxItem[];
  unreadCount: number;
  onOpenItem: (item: NotificationInboxItem) => void;
  onMarkAllRead?: () => void;
  onEnablePush?: () => void;
  pushEnabled?: boolean;
  soundMuted?: boolean;
  onToggleSoundMute?: () => void;
  /** From inbox context — restarts the unread badge pulse when it increments. */
  unreadArrivalNonce?: number;
};

export function NotificationInboxTray({
  items,
  unreadCount,
  onOpenItem,
  onMarkAllRead,
  onEnablePush,
  pushEnabled = false,
  soundMuted = false,
  onToggleSoundMute,
  unreadArrivalNonce = 0,
}: NotificationInboxTrayProps) {
  const unreadLabel = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";
  const label = soundMuted ? `${unreadLabel}, sound muted` : unreadLabel;
  const pulseAttr = useInboxBadgePulseAttr(unreadArrivalNonce);
  const showPushToggle = Boolean(onEnablePush) && !pushEnabled;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={soundMuted ? <BellOff aria-hidden /> : <Bell aria-hidden />}
          label={label}
          variant="outline"
          size="md"
          showTooltip={false}
          className="notification-inbox-tray__trigger"
          data-count={unreadCount > 0 ? String(unreadCount) : undefined}
          data-pulse={pulseAttr}
          data-muted={soundMuted ? "" : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="notification-inbox-tray__popover"
        aria-label="Notifications"
        onOpenAutoFocus={(event) => {
          // Keep focus on the bell; autofocusing Mark all read opens its tooltip.
          event.preventDefault();
        }}
      >
        <div className="notification-inbox-tray__header">
          <div className="notification-inbox-tray__heading">
            <h2 className="notification-inbox-tray__heading-text">Notifications</h2>
            {unreadCount > 0 ? (
              <span className="notification-inbox-tray__count">
                {unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </div>
          {onMarkAllRead ? (
            <Button
              icon={<CheckCheck aria-hidden />}
              label="Mark all as read"
              variant="outline"
              size="sm"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
            />
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="notification-inbox-tray__empty">You're all caught up.</p>
        ) : (
          <ul className="notification-inbox-tray__list">
            {items.map((item) => (
              <NotificationInboxRow key={item.id} item={item} onOpenItem={onOpenItem} />
            ))}
          </ul>
        )}
        <div className="notification-inbox-tray__footer">
          <div className="notification-inbox-tray__footer-actions">
            {showPushToggle ? (
              <IconButton
                icon={<BellRing aria-hidden />}
                label="Enable alerts"
                variant="ghost"
                size="sm"
                onClick={onEnablePush}
              />
            ) : null}
            {onToggleSoundMute ? (
              <IconButton
                icon={soundMuted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
                label={soundMuted ? "Unmute notification sound" : "Mute notification sound"}
                variant="ghost"
                size="sm"
                onClick={onToggleSoundMute}
              />
            ) : null}
          </div>
          <span className="notification-inbox-tray__hint" aria-hidden>
            Esc to dismiss
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function actorKey(item: NotificationInboxItem, actor: string): string {
  const username = item.data?.actorUsername;
  return typeof username === "string" && username.trim() !== "" ? username : actor;
}

function NotificationInboxRow({
  item,
  onOpenItem,
}: {
  item: NotificationInboxItem;
  onOpenItem: (item: NotificationInboxItem) => void;
}) {
  const unread = item.readAt == null;
  const appId = notificationInboxAppId(item);
  const domain = notificationInboxDomainLabel(appId);
  const time = formatNotificationRelativeTime(item.createdAt);
  const { title, titleActor, titleRest, body } = formatNotificationCopy(item);
  const hasActor = titleActor != null && titleRest != null;
  const absoluteTime =
    item.createdAt && !Number.isNaN(Date.parse(item.createdAt))
      ? new Date(item.createdAt).toLocaleString()
      : undefined;

  return (
    <li
      className="notification-inbox-tray__row"
      data-unread={unread ? "true" : "false"}
      data-app={appId}
    >
      <button
        type="button"
        className="notification-inbox-tray__open"
        onClick={() => onOpenItem(item)}
      >
        <span className="notification-inbox-tray__dot" aria-hidden />
        <NotificationInboxMark
          appId={appId}
          domain={domain}
          actor={hasActor ? titleActor : null}
          actorKey={hasActor ? actorKey(item, titleActor) : ""}
        />
        <span className="notification-inbox-tray__main">
          <span className="notification-inbox-tray__title-line">
            <span
              className={
                hasActor
                  ? "notification-inbox-tray__row-title"
                  : "notification-inbox-tray__row-title notification-inbox-tray__row-title--plain"
              }
            >
              {unread ? <span className="sr-only">Unread. </span> : null}
              {hasActor ? (
                <>
                  <strong className="notification-inbox-tray__title-actor">{titleActor}</strong>
                  <span className="notification-inbox-tray__title-rest">{titleRest}</span>
                </>
              ) : (
                title
              )}
              <span className="sr-only">, {domain}</span>
            </span>
            {time ? (
              <time
                className="notification-inbox-tray__time"
                dateTime={item.createdAt ?? undefined}
                title={absoluteTime}
              >
                {time}
              </time>
            ) : null}
          </span>
          {body ? <span className="notification-inbox-tray__row-body">{body}</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * Who + where: the actor's avatar with the app icon as a corner badge.
 * Rows without an actor (reminders) show the app icon on its own.
 */
function NotificationInboxMark({
  appId,
  domain,
  actor,
  actorKey,
}: {
  appId: WorkspaceAppId;
  domain: string;
  actor: string | null;
  actorKey: string;
}) {
  if (actor == null) {
    return (
      <span className="notification-inbox-tray__mark" title={domain} aria-hidden>
        <WorkspaceAppIcon appId={appId} className="notification-inbox-tray__app-icon" />
      </span>
    );
  }
  return (
    <span className="notification-inbox-tray__mark" title={domain} aria-hidden>
      <UserAvatar
        displayName={actor}
        compact
        size="xl"
        color={avatarColorForUserId(actorKey)}
        className="notification-inbox-tray__avatar"
      />
      <span className="notification-inbox-tray__app-badge">
        <WorkspaceAppIcon appId={appId} className="notification-inbox-tray__app-badge-icon" />
      </span>
    </span>
  );
}
