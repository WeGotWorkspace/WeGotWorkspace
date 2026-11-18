import { useMemo, useState } from "react";
import { Bell, BellOff, BellRing, CheckCheck, LayoutGrid, Volume2, VolumeX } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
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
  /**
   * The app the user is in. When set, the header offers "All apps" vs this app.
   * Omit on home and in apps that raise no notifications.
   */
  currentAppId?: WorkspaceAppId;
  /** Marks the matching unread rows read; used by "Mark all as read" in the app scope. */
  onMarkReadWhere?: (match: (item: NotificationInboxItem) => boolean) => void;
};

type InboxScope = "all" | "app";

const SCOPE_STORAGE_KEY = "wgw.notifications.tray-scope";

/** Device-local convenience: the tray reopens on the scope last picked. */
function readStoredScope(): InboxScope {
  try {
    return window.localStorage.getItem(SCOPE_STORAGE_KEY) === "app" ? "app" : "all";
  } catch {
    return "all";
  }
}

function storeScope(scope: InboxScope): void {
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, scope);
  } catch {
    // Private mode or blocked storage: the scope just resets on reload.
  }
}

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
  currentAppId,
  onMarkReadWhere,
}: NotificationInboxTrayProps) {
  const [storedScope, setStoredScope] = useState<InboxScope>(readStoredScope);
  const scope: InboxScope = currentAppId ? storedScope : "all";
  const appItems = useMemo(
    () =>
      currentAppId ? items.filter((item) => notificationInboxAppId(item) === currentAppId) : items,
    [items, currentAppId],
  );
  const appUnreadCount = useMemo(
    () => appItems.filter((item) => item.readAt == null).length,
    [appItems],
  );
  const shownItems = scope === "app" ? appItems : items;
  const shownUnreadCount = scope === "app" ? appUnreadCount : unreadCount;
  const currentAppName = currentAppId ? notificationInboxDomainLabel(currentAppId) : "";
  // The bell counts what the tray lists: every app, or only this one.
  const unreadScopeLabel =
    scope === "app"
      ? `${shownUnreadCount} unread in ${currentAppName}`
      : `${shownUnreadCount} unread`;
  const unreadLabel =
    shownUnreadCount > 0 ? `Notifications (${unreadScopeLabel})` : "Notifications";
  const label = soundMuted ? `${unreadLabel}, sound muted` : unreadLabel;
  const canMarkShownRead = scope === "app" ? Boolean(onMarkReadWhere) : Boolean(onMarkAllRead);
  const pickScope = (next: InboxScope) => {
    setStoredScope(next);
    storeScope(next);
  };
  const markShownRead = () => {
    if (scope === "app" && currentAppId) {
      onMarkReadWhere?.((item) => notificationInboxAppId(item) === currentAppId);
      return;
    }
    onMarkAllRead?.();
  };
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
          data-count={shownUnreadCount > 0 ? String(shownUnreadCount) : undefined}
          data-pulse={pulseAttr}
          data-muted={soundMuted ? "" : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        frost
        className="notification-inbox-tray__popover"
        aria-label="Notifications"
        onOpenAutoFocus={(event) => {
          // Keep focus on the bell; autofocusing Mark all as read would move focus off the trigger.
          event.preventDefault();
        }}
      >
        <div className="notification-inbox-tray__header">
          <h2 className="notification-inbox-tray__heading">Notifications</h2>
          <div className="notification-inbox-tray__header-actions">
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
            {currentAppId ? (
              <DropdownMenu
                align="end"
                trigger={
                  <CollectionGhostButton
                    className="notification-inbox-tray__scope"
                    aria-label={
                      scope === "app"
                        ? `Showing ${currentAppName} notifications, change`
                        : "Showing notifications from all apps, change"
                    }
                    leading={
                      scope === "app" ? (
                        <WorkspaceAppIcon
                          appId={currentAppId}
                          className="notification-inbox-tray__scope-icon"
                        />
                      ) : (
                        <LayoutGrid className="notification-inbox-tray__scope-icon" aria-hidden />
                      )
                    }
                    label={null}
                  />
                }
                items={[
                  {
                    id: "all",
                    label: "All apps",
                    icon: <LayoutGrid className="size-4" aria-hidden />,
                    badge: unreadCount > 0 ? unreadCount : undefined,
                    checked: scope === "all",
                    selected: scope === "all",
                    onClick: () => pickScope("all"),
                  },
                  {
                    id: "app",
                    label: currentAppName,
                    icon: (
                      <WorkspaceAppIcon appId={currentAppId} className="size-4 rounded-[4px]" />
                    ),
                    badge: appUnreadCount > 0 ? appUnreadCount : undefined,
                    checked: scope === "app",
                    selected: scope === "app",
                    onClick: () => pickScope("app"),
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
        {shownItems.length === 0 ? (
          <p className="notification-inbox-tray__empty">
            {scope === "app" ? `Nothing in ${currentAppName} yet.` : "You're all caught up."}
          </p>
        ) : (
          <ul className="notification-inbox-tray__list">
            {shownItems.map((item) => (
              <NotificationInboxRow key={item.id} item={item} onOpenItem={onOpenItem} />
            ))}
          </ul>
        )}
        <div className="notification-inbox-tray__footer">
          <span className="notification-inbox-tray__hint" aria-hidden>
            Esc to dismiss
          </span>
          {canMarkShownRead ? (
            <Button
              icon={<CheckCheck aria-hidden />}
              label="Mark all as read"
              className="shrink-0"
              variant="outline"
              size="sm"
              onClick={markShownRead}
              disabled={shownUnreadCount === 0}
            />
          ) : null}
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
