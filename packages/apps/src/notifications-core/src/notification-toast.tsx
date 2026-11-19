import { toast } from "sonner";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { NotificationItemContent } from "@/notifications-core/src/notification-item";
import { notificationInboxAppId } from "@/notifications-core/src/notification-inbox-row-meta";
import "@/notifications-core/src/notification-toast.css";

export type NotificationToastProps = {
  toastId: string | number;
  item: NotificationInboxItem;
  /** Opens the row's `navigate` and marks it read (the popover's row click). */
  onOpen: (item: NotificationInboxItem) => void;
};

/**
 * An inbox row as an in-app toast: the same content as the tray row
 * ({@link NotificationItemContent}) on the toaster's frosted surface. One button
 * opens it and closes the toast. A status region that never takes focus;
 * Sonner's toaster (Alt+T, or Tab) reaches it from the keyboard.
 */
export function NotificationToast({ toastId, item, onOpen }: NotificationToastProps) {
  return (
    <div role="status" className="notification-toast" data-app={notificationInboxAppId(item)}>
      <button
        type="button"
        className="notification-toast__open"
        onClick={() => {
          onOpen(item);
          toast.dismiss(toastId);
        }}
      >
        <NotificationItemContent item={item} />
      </button>
    </div>
  );
}
