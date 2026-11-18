import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppRail } from "@/app-rail/src/app-rail";
import { AppRailAccountSlotContext } from "@/app-rail/src/app-rail-account";
import { useAppRailVisible } from "@/app-rail/src/use-app-rail-visible";
import { createPortal } from "react-dom";
import { AppSwitchButton } from "@/app-switch-button/src/app-switch-button";
import { APP_SWITCH_PRODUCT_APPS } from "@/app-switch-button/src/app-switch-menu-apps";
import { useRouterState } from "@tanstack/react-router";
import { bindOpenSidebarStatusBar } from "@/app-sidebar/src/sidebar-status-bar";
import { cn } from "@/lib/utils";
import {
  dismissSidebarOverlay,
  sidebarSelectClickDismisses,
} from "@/workspace-shell/src/sidebar-breakpoint";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import { useNotificationsInbox } from "@/lib/notifications/notifications-inbox-context";
import "@/app-sidebar/src/app-sidebar.css";
import { publishElementHeight } from "@/lib/publish-element-height";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import {
  AppSidebarPrimaryProvider,
  useWorkspaceAppSettingsMenuItem,
} from "@/app-sidebar/src/app-sidebar-primary";
import { IconButton } from "@/button/src/button";

export type AppSidebarProps = {
  open: boolean;
  onCloseMobile: () => void;
  /** Main nav / section content (e.g. `SidebarSection` list). Padding and scroll live in the shell. */
  children: ReactNode;
  /** Pinned below the scroll region (e.g. `WorkspaceUserFooter`). */
  footer?: ReactNode;
  /** Primary CTA under the header (e.g. Compose, New). */
  primaryButton?: ReactNode;
  /**
   * The app whose Settings is the last option in the primary button's menu (a
   * `SidebarSegmentedNewMenu`, which turns into a split button for it).
   */
  settingsAppId?: WorkspaceAppId;
  /** Applied to the scroll stack (primary button + sections), e.g. drive `--color-we-got-dark` override. */
  scrollSurfaceStyle?: CSSProperties;
  /** Passed to `AppSwitchButton` (e.g. install shell). */
  appSwitchDisabled?: boolean;
  appSwitchSubtitle?: string;
  className?: string;
};

/**
 * Inbox tray alone — kept below the lockup so unread / presence-driven inbox
 * refreshes do not re-render {@link AppSwitchButton} or rewrite the inlined SVG.
 */
function AppSidebarNotifications({ inRail = false }: { inRail?: boolean }) {
  const inbox = useNotificationsInbox();
  const path = useRouterState({ select: (r) => r.location.pathname });
  if (!inbox) return null;
  const currentApp = APP_SWITCH_PRODUCT_APPS.find(
    (app) => path === app.to || path.startsWith(`${app.to}/`),
  );
  return (
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
        currentAppId={currentApp?.id}
        onMarkReadWhere={(match) => void inbox.markReadWhere(match)}
        popoverSide={inRail ? "right" : "bottom"}
      />
    </div>
  );
}

/**
 * The app's Settings as a header button. Beside the app rail the bell moved to
 * the rail; Settings takes its place and leaves the primary button's menu.
 * Nothing for an app without a settings panel.
 */
function AppSidebarSettingsButton({ appId }: { appId: WorkspaceAppId }) {
  const item = useWorkspaceAppSettingsMenuItem(appId);
  if (!item) return null;
  return (
    <div className="app-sidebar__notifications">
      <IconButton
        icon={item.icon}
        label={typeof item.label === "string" ? item.label : "Settings"}
        variant="outline"
        size="md"
        onClick={item.onClick}
      />
    </div>
  );
}

export function AppSidebar({
  open,
  onCloseMobile,
  children,
  footer,
  primaryButton,
  settingsAppId,
  scrollSurfaceStyle,
  appSwitchDisabled = false,
  appSwitchSubtitle,
  className,
}: AppSidebarProps) {
  const sidebarRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [railAccountSlot, setRailAccountSlot] = useState<HTMLElement | null>(null);
  const [railNotificationsSlot, setRailNotificationsSlot] = useState<HTMLElement | null>(null);
  // One live bell: at the top of the app rail. Home and install have no rail and keep it in the header.
  const bellInRail = !appSwitchDisabled && railNotificationsSlot != null;
  // Beside a docked rail the tray opens to its right; in the drawer it drops below the bell.
  const railDocked = useAppRailVisible();
  useEffect(() => bindOpenSidebarStatusBar(sidebarRef.current, open), [open]);
  // The footer floats over the list so rows scroll under the frosted account card.
  useEffect(
    () =>
      publishElementHeight(sidebarRef.current, footerRef.current, "--app-sidebar-footer-height"),
    [footer],
  );

  const handleSidebarClick = (event: MouseEvent<HTMLElement>) => {
    if (!sidebarSelectClickDismisses(event.target)) return;
    dismissSidebarOverlay(onCloseMobile);
  };

  return (
    <>
      {bellInRail && railNotificationsSlot
        ? createPortal(<AppSidebarNotifications inRail={railDocked} />, railNotificationsSlot)
        : null}
      {appSwitchDisabled ? null : (
        <AppRail
          accountSlotRef={setRailAccountSlot}
          notificationsSlotRef={setRailNotificationsSlot}
        />
      )}
      {open ? <div className="app-sidebar__scrim" onClick={onCloseMobile} aria-hidden /> : null}
      <aside
        ref={sidebarRef}
        data-open={open ? "true" : "false"}
        className={cn("app-sidebar", className)}
        onClick={handleSidebarClick}
      >
        <header className="app-sidebar__header">
          <div className="app-sidebar__header-main">
            <AppSwitchButton disabled={appSwitchDisabled} subtitle={appSwitchSubtitle} />
          </div>
          {bellInRail ? (
            settingsAppId ? (
              <AppSidebarSettingsButton appId={settingsAppId} />
            ) : null
          ) : (
            <AppSidebarNotifications />
          )}
        </header>

        <div className="app-sidebar__scroll">
          <div className="app-sidebar__scroll-surface" style={scrollSurfaceStyle}>
            {primaryButton != null ? (
              <div className="app-sidebar__primary-button">
                <AppSidebarPrimaryProvider settingsAppId={bellInRail ? undefined : settingsAppId}>
                  {primaryButton}
                </AppSidebarPrimaryProvider>
              </div>
            ) : null}
            <div className="app-sidebar__sections">{children}</div>
          </div>
        </div>

        {footer ? (
          <footer ref={footerRef} className="app-sidebar__footer">
            <AppRailAccountSlotContext.Provider value={railAccountSlot}>
              {footer}
            </AppRailAccountSlotContext.Provider>
          </footer>
        ) : null}
      </aside>
    </>
  );
}
