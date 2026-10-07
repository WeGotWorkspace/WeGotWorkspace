import { WorkspaceHomeIcon } from "@/lib/workspace-app-icon";
import { cn } from "@/lib/utils";
import {
  WE_GOT_WORKSPACE_WORDMARK_LABEL,
  WeGotWorkspaceWordmark,
} from "@/brand-lockup/src/we-got-workspace-wordmark";
import "@/app-switch-button/src/app-switch-button.css";
import "@/brand-lockup/src/brand-lockup.css";

export type BrandLockupProps = {
  className?: string;
};

/**
 * Static WeGotWorkspace brand lockup (suite mark + wordmark).
 * Geometry matches {@link AppSwitchButton} workspace trigger so cream auth
 * shells (login / install / forgot) align with the app-switch when navigating in.
 * Signed-in dashboard home uses {@link AppSwitchButton} instead.
 */
export function BrandLockup({ className }: BrandLockupProps) {
  return (
    <div
      className={cn(
        "brand-lockup",
        "app-switch-button__trigger",
        "app-switch-button__trigger--workspace",
        className,
      )}
      role="img"
      aria-label={WE_GOT_WORKSPACE_WORDMARK_LABEL}
    >
      <WorkspaceHomeIcon className="app-switch-button__icon" variant="switch-trigger" />
      <WeGotWorkspaceWordmark />
    </div>
  );
}
