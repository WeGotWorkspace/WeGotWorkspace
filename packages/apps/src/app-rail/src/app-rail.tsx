import { memo, useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import {
  APP_SWITCH_PRODUCT_APPS,
  appSwitchUtilityApps,
  type AppSwitchMenuApp,
} from "@/app-switch-button/src/app-switch-menu-apps";
import { useShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";
import { useNotificationsInbox } from "@/lib/notifications/notifications-inbox-context";
import { notificationInboxAppId } from "@/notifications-core/src/notification-inbox-row-meta";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "@/app-rail/src/app-rail.css";

type AppRailItemProps = {
  app: AppSwitchMenuApp;
  current: boolean;
  /** Unread notifications for this app: shows the dot (no count). */
  unread: boolean;
};

function AppRailItem({ app, current, unread }: AppRailItemProps) {
  return (
    <li className="app-rail__item">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={app.to}
            className="app-rail__link"
            aria-label={unread ? `${app.label}, new notifications` : app.label}
            aria-current={current ? "page" : undefined}
            data-unread={unread ? "" : undefined}
          >
            <WorkspaceAppIcon appId={app.id} className="app-rail__icon" variant="switch-trigger" />
            {unread ? <span className="app-rail__dot" aria-hidden /> : null}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{app.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * Suite app rail: one tile per app, left of the AppSidebar. CSS shows it only
 * on wide landscape viewports (see `app-rail.css`); below that the sidebar
 * header's AppSwitchButton is the switcher.
 */
export const AppRail = memo(function AppRail() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const showAdmin = useShowAdminApp();
  const inbox = useNotificationsInbox();
  const inboxItems = inbox?.items;
  const unreadApps = useMemo(() => {
    const apps = new Set<WorkspaceAppId>();
    for (const item of inboxItems ?? []) {
      if (item.readAt == null) apps.add(notificationInboxAppId(item));
    }
    return apps;
  }, [inboxItems]);
  const isCurrent = (app: AppSwitchMenuApp) => path === app.to || path.startsWith(`${app.to}/`);

  return (
    <nav className="app-rail" aria-label="Apps">
      <ul className="app-rail__list">
        {APP_SWITCH_PRODUCT_APPS.map((app) => (
          <AppRailItem
            key={app.id}
            app={app}
            current={isCurrent(app)}
            unread={unreadApps.has(app.id)}
          />
        ))}
      </ul>
      <ul className="app-rail__list app-rail__list--utility">
        {appSwitchUtilityApps(showAdmin).map((app) => (
          <AppRailItem
            key={app.id}
            app={app}
            current={isCurrent(app)}
            unread={unreadApps.has(app.id)}
          />
        ))}
      </ul>
    </nav>
  );
});
