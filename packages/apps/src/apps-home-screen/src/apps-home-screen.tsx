import type { ReactNode } from "react";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { cn } from "@/lib/utils";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/apps-home-screen/src/apps-home-screen.css";

export type AppsHomeScreenItem = {
  id: string;
  label: string;
  /** Branded app tile when set (exact artwork from `/app-icons/`). */
  appId?: WorkspaceAppId;
  /** Lucide or custom node when neither `appId` nor `iconSrc` is set. */
  icon?: ReactNode;
  /** @deprecated Prefer `appId` — legacy PNG callers; manifests now use SVG via `appId`. */
  iconSrc?: string;
  accent: string;
  fg?: string;
  onSelect?: () => void;
};

type AppsHomeScreenProps = {
  apps: AppsHomeScreenItem[];
  className?: string;
  userDisplayName?: string;
  showUserMenu?: boolean;
  onLogout?: () => void;
};

/** Shared, presentational app home screen with a rounded icon grid. */
export function AppsHomeScreen({
  apps,
  className,
  userDisplayName = "User",
  showUserMenu = false,
  onLogout,
}: AppsHomeScreenProps) {
  return (
    <section className={cn("apps-home-screen flex w-full min-h-dvh flex-col", className)}>
      <WorkspaceShellHeader
        appSwitchSubtitle="Workspace"
        session={
          showUserMenu && onLogout
            ? { user: { displayName: userDisplayName }, viewerInboxLabel: "me" }
            : undefined
        }
        onLogout={showUserMenu ? onLogout : undefined}
        displayName={userDisplayName}
      />

      <div className="flex flex-1 items-center justify-center px-6 py-10 md:px-10 md:py-14">
        <div className="grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={app.onSelect}
              className="group flex w-full min-h-48 flex-col items-center justify-center gap-4 rounded-3xl p-3 text-center transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ink) focus-visible:ring-offset-2"
              aria-label={app.label}
            >
              {app.appId ? (
                <span className="apps-home-screen__tile-icon">
                  <WorkspaceAppIcon appId={app.appId} variant="tile" />
                </span>
              ) : app.iconSrc ? (
                <span className="apps-home-screen__tile-icon">
                  <img
                    src={app.iconSrc}
                    alt=""
                    className="workspace-app-icon--tile"
                    draggable={false}
                  />
                </span>
              ) : (
                <span
                  className="apps-home-screen__tile-icon--accent"
                  style={{ backgroundColor: app.accent, color: app.fg ?? "var(--color-ink)" }}
                >
                  <span className="text-current [&_svg]:size-12">{app.icon}</span>
                </span>
              )}
              <span className="text-sm font-medium">{app.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
