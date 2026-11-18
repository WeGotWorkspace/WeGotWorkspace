import { memo, useEffect, useMemo, type MouseEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { prefersReducedMotion } from "@/lib/view-transition";
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
import { lastAppLocation, rememberAppLocation } from "@/app-rail/src/last-app-location";
import "@/app-rail/src/app-rail.css";

type AppRailItemProps = {
  app: AppSwitchMenuApp;
  current: boolean;
  /** Unread notifications for this app: shows the dot (no count). */
  unread: boolean;
};

/**
 * App switch as one View Transition: the old app cross-fades into the new one
 * once it has loaded. The router's own `viewTransition` link option is lost on
 * the redirect every app does (`/notes` to `/notes/all`), so the rail runs the
 * transition around the whole navigation. Returns false when the browser should
 * handle the click itself (new tab, no API, reduced motion).
 */
function useAppSwitch(app: AppSwitchMenuApp) {
  const router = useRouter();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const plainClick =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainClick) return;
    event.preventDefault();
    // Back to where the user left this app; its start screen the first time.
    const last = lastAppLocation(app.id);
    const go = () =>
      last
        ? router.navigate({ to: last.pathname, search: router.options.parseSearch(last.searchStr) })
        : router.navigate({ to: app.to });
    if (typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
      void go();
      return;
    }
    document.startViewTransition(async () => {
      await go();
      // Let React commit the new app before the browser takes the "after" snapshot.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
}

function AppRailItem({ app, current, unread }: AppRailItemProps) {
  const switchApp = useAppSwitch(app);
  return (
    <li className="app-rail__item">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={app.to}
            // Another app: back to its last spot, cross-faded (the rail holds still, see CSS).
            // The current app's own tile is a plain link to its start screen.
            onClick={current ? undefined : switchApp}
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
type AppRailProps = {
  /** Receives the bottom slot element that the sidebar's account footer fills. */
  accountSlotRef?: (element: HTMLElement | null) => void;
  /** Receives the top slot element: the sidebar mounts the notifications bell there. */
  notificationsSlotRef?: (element: HTMLElement | null) => void;
};

/** Settings before Admin: everyone has the first, only admins the second. */
function byRailUtilityOrder(a: AppSwitchMenuApp, b: AppSwitchMenuApp): number {
  return Number(a.id !== "settings") - Number(b.id !== "settings");
}

export const AppRail = memo(function AppRail({
  accountSlotRef,
  notificationsSlotRef,
}: AppRailProps) {
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
  const searchStr = useRouterState({ select: (r) => r.location.searchStr });
  // Keep the current app's last spot up to date for the way back.
  useEffect(() => {
    const here = [...APP_SWITCH_PRODUCT_APPS, ...appSwitchUtilityApps(true)].find(
      (app) => path === app.to || path.startsWith(`${app.to}/`),
    );
    if (here) rememberAppLocation(here.id, { pathname: path, searchStr });
  }, [path, searchStr]);
  const isCurrent = (app: AppSwitchMenuApp) => path === app.to || path.startsWith(`${app.to}/`);

  return (
    <nav className="app-rail" aria-label="Apps">
      <div className="app-rail__notifications" ref={notificationsSlotRef} />
      {/* Tiles scroll when the screen is short; the bell above and the account below stay put. */}
      <div className="app-rail__scroll">
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
          {[...appSwitchUtilityApps(showAdmin)].sort(byRailUtilityOrder).map((app) => (
            <AppRailItem
              key={app.id}
              app={app}
              current={isCurrent(app)}
              unread={unreadApps.has(app.id)}
            />
          ))}
        </ul>
      </div>
      <div className="app-rail__account" ref={accountSlotRef} />
    </nav>
  );
});
