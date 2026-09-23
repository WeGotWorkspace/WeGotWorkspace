import type { ReactNode } from "react";
import type {
  AppSwitchButtonProps,
  AppSwitchButtonVariant,
} from "@/app-switch-button/src/app-switch-button";
import { BrandLockup } from "@/brand-lockup/src/brand-lockup";
import { WorkspaceAppSwitcher } from "@/workspace-app-switcher/src/workspace-app-switcher";
import { WorkspaceShellHeaderUserMenu } from "@/workspace-shell/src/workspace-shell-header-user-menu";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { cn } from "@/lib/utils";
import "@/workspace-shell/src/workspace-shell-header.css";

export type WorkspaceShellHeaderProps = {
  className?: string;
  /**
   * When true, render the static WeGotWorkspace brand lockup instead of the
   * app switcher (unauthenticated cream shells: login / install / forgot).
   * Signed-in home uses the app switcher with `appSwitchSubtitle="Workspace"`.
   */
  brandLockup?: boolean;
  /** Passed to `WorkspaceAppSwitcher` (ignored when `brandLockup`). */
  appSwitchDisabled?: boolean;
  appSwitchSubtitle?: string;
  appSwitchVariant?: AppSwitchButtonVariant;
  /** Rendered beside the app switcher / brand lockup (e.g. open document name in Docs). */
  startAccessory?: ReactNode;
  /** Rendered on the right before the account chip (e.g. word count in Docs). */
  endAccessory?: ReactNode;
  onAppSelect?: AppSwitchButtonProps["onSelect"];
  /** When set with `onLogout`, can render the header account chip (see `showUserAccount`). */
  session?: WorkspaceSession;
  /** Account chip title; defaults to `session.user.displayName`. */
  displayName?: string;
  onLogout?: () => void;
  /**
   * Header end slot: signed-in account footer. Defaults to true when both `session` and
   * `onLogout` are provided (meet guest join flow passes `false`).
   */
  showUserAccount?: boolean;
};

export function WorkspaceShellHeader({
  className,
  brandLockup = false,
  appSwitchDisabled = false,
  appSwitchSubtitle,
  appSwitchVariant,
  startAccessory,
  endAccessory,
  onAppSelect,
  session,
  displayName,
  onLogout,
  showUserAccount,
}: WorkspaceShellHeaderProps) {
  const accountVisible =
    (showUserAccount ?? Boolean(session && onLogout)) && session != null && onLogout != null;
  const accountName = displayName ?? session?.user.displayName ?? "Guest";

  return (
    <header className={cn("workspace-shell-header", className)}>
      <div className="workspace-shell-header__start">
        {brandLockup ? (
          <BrandLockup />
        ) : (
          <WorkspaceAppSwitcher
            disabled={appSwitchDisabled}
            subtitle={appSwitchSubtitle}
            variant={appSwitchVariant}
            onSelect={onAppSelect}
          />
        )}
        {startAccessory ? (
          <div className="workspace-shell-header__accessory">{startAccessory}</div>
        ) : null}
      </div>
      <div className="workspace-shell-header__end">
        {endAccessory ? (
          <div className="workspace-shell-header__end-accessory">{endAccessory}</div>
        ) : null}
        {accountVisible ? (
          <div className="workspace-shell-header__account">
            <WorkspaceShellHeaderUserMenu displayName={accountName} onLogout={onLogout} />
          </div>
        ) : (
          <div className="workspace-shell-header__spacer" aria-hidden />
        )}
      </div>
    </header>
  );
}
