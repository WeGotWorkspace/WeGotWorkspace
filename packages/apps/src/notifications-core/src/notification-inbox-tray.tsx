import { Bell, BellRing, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import {
  formatNotificationRelativeTime,
  notificationInboxAppId,
  notificationInboxDomainLabel,
} from "@/notifications-core/src/notification-inbox-row-meta";
import { formatNotificationCopy } from "@/notifications-core/src/format-notification-copy";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import { useInboxBadgePulseAttr } from "@/notifications-core/src/use-inbox-badge-pulse";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ViewHeader } from "@/view-header/src/view-header";
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
  const label = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";
  const pulseAttr = useInboxBadgePulseAttr(unreadArrivalNonce);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={<Bell aria-hidden />}
          label={label}
          variant="outline"
          size="md"
          showTooltip={false}
          className="notification-inbox-tray__trigger"
          data-count={unreadCount > 0 ? String(unreadCount) : undefined}
          data-pulse={pulseAttr}
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
          <ViewHeader
            hideSidebarToggle
            title="Notifications"
            actions={
              <>
                {onEnablePush && !pushEnabled ? (
                  <IconButton
                    icon={<BellRing aria-hidden />}
                    label="Enable alerts"
                    variant="outline"
                    size="sm"
                    onClick={onEnablePush}
                  />
                ) : null}
                {onToggleSoundMute ? (
                  <IconButton
                    icon={soundMuted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
                    label={soundMuted ? "Unmute notification sound" : "Mute notification sound"}
                    variant="outline"
                    size="sm"
                    onClick={onToggleSoundMute}
                  />
                ) : null}
                {onMarkAllRead ? (
                  <IconButton
                    icon={<CheckCheck aria-hidden />}
                    label="Mark all read"
                    variant="outline"
                    size="sm"
                    onClick={onMarkAllRead}
                    disabled={unreadCount === 0}
                  />
                ) : null}
              </>
            }
          />
        </div>
        {items.length === 0 ? (
          <p className="notification-inbox-tray__empty">No notifications yet.</p>
        ) : (
          <ul className="notification-inbox-tray__list">
            {items.map((item) => (
              <NotificationInboxRow key={item.id} item={item} onOpenItem={onOpenItem} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
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
  const absoluteTime =
    item.createdAt && !Number.isNaN(Date.parse(item.createdAt))
      ? new Date(item.createdAt).toLocaleString()
      : undefined;

  return (
    <li>
      <button
        type="button"
        className="notification-inbox-tray__row"
        data-unread={unread ? "true" : "false"}
        data-app={appId}
        onClick={() => onOpenItem(item)}
      >
        <span className="notification-inbox-tray__icon">
          <WorkspaceAppIcon appId={appId} className="notification-inbox-tray__app-icon" />
        </span>
        <span className="notification-inbox-tray__main">
          <span className="notification-inbox-tray__meta">
            <span className="notification-inbox-tray__domain">{domain}</span>
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
          <span
            className={
              titleActor != null && titleRest != null
                ? "notification-inbox-tray__row-title"
                : "notification-inbox-tray__row-title notification-inbox-tray__row-title--plain"
            }
          >
            {unread ? <span className="sr-only">Unread. </span> : null}
            {titleActor != null && titleRest != null ? (
              <>
                <strong className="notification-inbox-tray__title-actor">{titleActor}</strong>
                <span className="notification-inbox-tray__title-rest">{titleRest}</span>
              </>
            ) : (
              title
            )}
          </span>
          {body ? <span className="notification-inbox-tray__row-body">{body}</span> : null}
        </span>
      </button>
    </li>
  );
}
