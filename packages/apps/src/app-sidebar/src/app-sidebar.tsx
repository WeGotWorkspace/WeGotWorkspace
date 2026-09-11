import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { AppSwitchButton } from "@/app-switch-button/src/app-switch-button";
import { IconButton } from "@/button/src/button";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_OVERLAY_MEDIA_QUERY,
  isSidebarOverlayViewport,
} from "@/workspace-shell/src/sidebar-breakpoint";
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

function useIsSidebarOverlay() {
  const [isOverlay, setIsOverlay] = useState(isSidebarOverlayViewport);
  useEffect(() => {
    const mql = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY);
    const onChange = () => setIsOverlay(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isOverlay;
}

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
  const isOverlay = useIsSidebarOverlay();
  return (
    <>
      {open ? <div className="app-sidebar__scrim" onClick={onCloseMobile} aria-hidden /> : null}
      <aside data-open={open ? "true" : "false"} className={cn("app-sidebar", className)}>
        <header className="app-sidebar__header">
          <div className="app-sidebar__header-main">
            <AppSwitchButton disabled={appSwitchDisabled} subtitle={appSwitchSubtitle} />
          </div>
          {isOverlay ? (
            <IconButton
              label="Close menu"
              icon={<X className="size-4" aria-hidden />}
              size="sm"
              variant="outline"
              showTooltip={false}
              onClick={onCloseMobile}
              className="app-sidebar__close"
            />
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
