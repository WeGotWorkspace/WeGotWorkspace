import { memo, useEffect, type MouseEvent } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { prefersReducedMotion } from "@/lib/view-transition";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import {
  APP_SWITCH_PRODUCT_APPS,
  appSwitchUtilityApps,
  type AppSwitchMenuApp,
} from "@/app-switch-button/src/app-switch-menu-apps";
import { useShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
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
 * the first time), as one View Transition, so the old app cross-fades into the
 * new one once it has loaded. The router's own `viewTransition` option is lost
 * on the redirect every app does (`/notes` to `/notes/all`), so the rail runs
 * the transition around the whole navigation. The current app's own tile goes
 * to its start screen. A modified click (new tab) is left to the browser.
 */
function useAppSwitch(app: AppSwitchMenuApp, current: boolean) {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const plainClick =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (!plainClick) return;
    event.preventDefault();
    const last = current ? null : lastAppLocation(app.id);
    const go = () =>
      last ? navigate({ to: last.pathname, search: last.search }) : navigate({ to: app.to });
    if (current || typeof document.startViewTransition !== "function" || prefersReducedMotion()) {
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
 * Suite app rail: one tile per app, left of the AppSidebar. CSS shows it only
 * on wide landscape viewports (see `app-rail.css`); below that the sidebar
 * header's AppSwitchButton is the switcher.
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
    const here = [...APP_SWITCH_PRODUCT_APPS, ...appSwitchUtilityApps(true)].find(
      (app) => path === app.to || path.startsWith(`${app.to}/`),
    );
    if (here) rememberAppLocation(here.id, { pathname: path, search: search ?? {} });
  }, [path, search]);
  const isCurrent = (app: AppSwitchMenuApp) => path === app.to || path.startsWith(`${app.to}/`);

  return (
    // Own provider: the rail also mounts where no suite-level tooltip provider is above it.
    <TooltipProvider>
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
    </TooltipProvider>
  );
});
