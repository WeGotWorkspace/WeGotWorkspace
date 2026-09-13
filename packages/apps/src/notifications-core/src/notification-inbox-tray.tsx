import { useId } from "react";
import { Bell } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import "@/notifications-core/src/notification-inbox-tray.css";

export type NotificationInboxTrayProps = {
  items: readonly NotificationInboxItem[];
  unreadCount: number;
  onOpenItem: (item: NotificationInboxItem) => void;
  onEnablePush?: () => void;
  pushEnabled?: boolean;
};

export function NotificationInboxTray({
  items,
  unreadCount,
  onOpenItem,
  onEnablePush,
  pushEnabled = false,
}: NotificationInboxTrayProps) {
  const titleId = useId();
  const label = unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={<Bell aria-hidden />}
          label={label}
          variant="outline"
          size="sm"
          showTooltip={false}
          className="notification-inbox-tray__trigger"
          data-count={unreadCount > 0 ? String(unreadCount) : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="notification-inbox-tray__popover"
        aria-labelledby={titleId}
      >
        <div className="notification-inbox-tray__header">
          <h2 id={titleId} className="notification-inbox-tray__title">
            Notifications
          </h2>
          {onEnablePush && !pushEnabled ? (
            <button
              type="button"
              className="notification-inbox-tray__enable"
              onClick={onEnablePush}
            >
              Enable alerts
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="notification-inbox-tray__empty">No notifications yet.</p>
        ) : (
          <ul className="notification-inbox-tray__list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="notification-inbox-tray__row"
                  data-unread={item.readAt ? "false" : "true"}
                  onClick={() => onOpenItem(item)}
                >
                  <span className="notification-inbox-tray__row-title">{item.title}</span>
                  {item.body ? (
                    <span className="notification-inbox-tray__row-body">{item.body}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
