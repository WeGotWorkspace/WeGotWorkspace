import { memo, useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import {
  APP_SWITCH_PRODUCT_APPS,
  appSwitchAppAtPath,
  appSwitchUtilityApps,
  type AppSwitchMenuApp,
} from "@/app-switch-button/src/app-switch-menu-apps";
import { useShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import { releaseAppFadeHold, settleAppFade } from "@/app-rail/src/app-switch-fade";
import { lastAppLocation, rememberAppLocation } from "@/app-rail/src/last-app-location";
import "@/app-rail/src/app-rail.css";

type AppRailItemProps = {
  app: AppSwitchMenuApp;
  current: boolean;
  /** Unread notifications for this app: shows the dot (no count). */
  unread: boolean;
};

/**
 * A tile's click. Another app: back to where the user left it (its start screen
 * the first time). The current app's own tile goes to its start screen. A plain
 * router navigation, no View Transition: the route must commit even when some
 * other transition is running. The new app fades in through CSS (`app-rail.css`).
 * A modified click (new tab) is left to the browser.
 */
function useAppSwitch(app: AppSwitchMenuApp, current: boolean) {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const plainClick =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainClick) return;
    event.preventDefault();
    releaseAppFadeHold();
    const last = current ? null : lastAppLocation(app.id);
    void navigate(last ? { to: last.pathname, search: last.search } : { to: app.to });
  };
}

function AppRailItem({ app, current, unread }: AppRailItemProps) {
  const switchApp = useAppSwitch(app, current);
  return (
    <li className="app-rail__item">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A real link (new tab, copy address); a plain click goes through the router. */}
          <a
            href={app.to}
            onClick={switchApp}
            className="app-rail__link"
            // "Open …": the bare app name is also the name of in-app controls (Meet's "Meet").
            aria-label={unread ? `Open ${app.label}, new notifications` : `Open ${app.label}`}
            aria-current={current ? "page" : undefined}
            data-unread={unread ? "" : undefined}
          >
            <WorkspaceAppIcon appId={app.id} className="app-rail__icon" variant="switch-trigger" />
            {unread ? <span className="app-rail__dot" aria-hidden /> : null}
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">{app.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * Suite app rail: one tile per app, the app switcher at every width. Docked left
 * of the AppSidebar from the sidebar's dock width; below it, the leading strip of
 * the sidebar drawer (see `app-rail.css`). Home and install do not mount it.
 */
type AppRailProps = {
  /** Receives the bottom slot element that the sidebar's account footer fills. */
  accountSlotRef?: (element: HTMLElement | null) => void;
  /** Receives the top slot element: the sidebar mounts the notifications bell there. */
  notificationsSlotRef?: (element: HTMLElement | null) => void;
  /** Apps with unread notifications: their tiles show a dot. The host owns the inbox. */
  unreadAppIds?: ReadonlySet<WorkspaceAppId>;
};

const NO_UNREAD_APPS: ReadonlySet<WorkspaceAppId> = new Set();

/** Settings before Admin: everyone has the first, only admins the second. */
function byRailUtilityOrder(a: AppSwitchMenuApp, b: AppSwitchMenuApp): number {
  return Number(a.id !== "settings") - Number(b.id !== "settings");
}

export const AppRail = memo(function AppRail({
  accountSlotRef,
  notificationsSlotRef,
  unreadAppIds: unreadApps = NO_UNREAD_APPS,
}: AppRailProps) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const showAdmin = useShowAdminApp();
  const search = useRouterState({
    select: (r) => r.location.search as Record<string, unknown> | undefined,
  });
  // Keep the current app's last spot up to date for the way back.
  useEffect(() => {
    const here = appSwitchAppAtPath(path);
    if (here) rememberAppLocation(here.id, { pathname: path, search: search ?? {} });
  }, [path, search]);
  // Before the first paint: the panes after the rail fade in once per app switch.
  const railRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (railRef.current) settleAppFade(railRef.current);
  }, []);
  const currentAppId = appSwitchAppAtPath(path)?.id;
  const isCurrent = (app: AppSwitchMenuApp) => app.id === currentAppId;

  return (
    // Own provider: the rail also mounts where no suite-level tooltip provider is above it.
    <TooltipProvider>
      <nav ref={railRef} className="app-rail" aria-label="Apps">
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
    </TooltipProvider>
  );
});
