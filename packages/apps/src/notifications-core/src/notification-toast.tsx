import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { formatNotificationCopy } from "@/notifications-core/src/format-notification-copy";
import {
  notificationInboxAppId,
  notificationInboxDomainLabel,
} from "@/notifications-core/src/notification-inbox-row-meta";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { AppToastCallout } from "@/ui/app-toast-callout";
import "@/notifications-core/src/notification-toast.css";

export type NotificationToastProps = {
  toastId: string | number;
  item: NotificationInboxItem;
  /** Opens the row's `navigate` and marks it read (the popover's row click). */
  onOpen: (item: NotificationInboxItem) => void;
};

/**
 * An inbox row as an in-app toast: app icon and name, actor and title, and
 * the body. One button opens it. A status region that never takes focus;
 * Sonner's toaster (Alt+T, or Tab) reaches it from the keyboard.
 */
export function NotificationToast({ toastId, item, onOpen }: NotificationToastProps) {
  const appId = notificationInboxAppId(item);
  const { title, titleActor, titleRest, body } = formatNotificationCopy(item);
  const heading =
    titleActor != null && titleRest != null ? (
      <>
        {/* A text space, so the button's accessible name does not run the two together. */}
        <strong className="notification-toast__actor">{titleActor}</strong>{" "}
        <span className="notification-toast__title-rest">{titleRest.trimStart()}</span>
      </>
    ) : (
      title
    );
  return (
    <div role="status" className="notification-toast" data-app={appId}>
      <AppToastCallout
        toastId={toastId}
        appName={notificationInboxDomainLabel(appId)}
        title={heading}
        message={body ?? undefined}
        severity="info"
        icon={<WorkspaceAppIcon appId={appId} className="notification-toast__app-icon" />}
        onSelect={() => onOpen(item)}
      />
    </div>
  );
}
