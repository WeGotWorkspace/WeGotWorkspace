import { type CSSProperties, type ReactNode } from "react";
import { AppSwitchButton } from "@/app-switch-button/src/app-switch-button";
import { cn } from "@/lib/utils";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import { useNotificationsInbox } from "@/notifications-core/src/notifications-inbox-context";
import "@/app-sidebar/src/app-sidebar.css";

export type AppSidebarProps = {
  open: boolean;
  onCloseMobile: () => void;
  /** Main nav / section content (e.g. `SidebarSection` list). Padding and scroll live in the shell. */
  children: ReactNode;
  /** Pinned below the scroll region (e.g. `WorkspaceUserFooter`). */
  footer?: ReactNode;
  /** Primary CTA under the header (e.g. Compose, New). */
  primaryButton?: ReactNode;
  /** Applied to the scroll stack (primary button + sections), e.g. drive `--color-ink` override. */
  scrollSurfaceStyle?: CSSProperties;
  /** Passed to `AppSwitchButton` (e.g. install shell). */
  appSwitchDisabled?: boolean;
  appSwitchSubtitle?: string;
  className?: string;
};

export function AppSidebar({
  open,
  onCloseMobile,
  children,
  footer,
  primaryButton,
  scrollSurfaceStyle,
  appSwitchDisabled = false,
  appSwitchSubtitle,
  className,
}: AppSidebarProps) {
  const inbox = useNotificationsInbox();
  return (
    <>
      {open ? <div className="app-sidebar__scrim" onClick={onCloseMobile} aria-hidden /> : null}
      <aside data-open={open ? "true" : "false"} className={cn("app-sidebar", className)}>
        <header className="app-sidebar__header">
          <div className="app-sidebar__header-main">
            <AppSwitchButton disabled={appSwitchDisabled} subtitle={appSwitchSubtitle} />
          </div>
          {inbox ? (
            <div className="app-sidebar__notifications">
              <NotificationInboxTray
                items={inbox.items}
                unreadCount={inbox.unreadCount}
                onOpenItem={inbox.onOpenItem}
                onMarkAllRead={inbox.onMarkAllRead}
                onEnablePush={inbox.onEnablePush}
                pushEnabled={inbox.pushEnabled}
                soundMuted={inbox.soundMuted}
                onToggleSoundMute={inbox.onToggleSoundMute}
                unreadArrivalNonce={inbox.unreadArrivalNonce}
              />
            </div>
          ) : null}
        </header>

        <div className="app-sidebar__scroll">
          <div className="app-sidebar__scroll-surface" style={scrollSurfaceStyle}>
            {primaryButton != null ? (
              <div className="app-sidebar__primary-button">{primaryButton}</div>
            ) : null}
            <div className="app-sidebar__sections">{children}</div>
          </div>
        </div>

        {footer ? <footer className="app-sidebar__footer">{footer}</footer> : null}
      </aside>
    </>
  );
}
