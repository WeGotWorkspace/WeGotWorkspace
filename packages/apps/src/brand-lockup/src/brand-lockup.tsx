import { WorkspaceHomeIcon } from "@/lib/workspace-app-icon";
import { cn } from "@/lib/utils";
import "@/app-switch-button/src/app-switch-button.css";
import "@/brand-lockup/src/brand-lockup.css";

/** Suite tagline — same copy as {@link AppSwitchButton} workspace lockup. */
const TAGLINE = "we got";
/** Product name line — with tagline reads as WeGotWorkspace. */
const PRODUCT_NAME = "Workspace";

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
      aria-label="WeGotWorkspace"
    >
      <WorkspaceHomeIcon className="app-switch-button__icon" variant="switch-trigger" />
      <span className="app-switch-button__label" aria-hidden>
        <span className="app-switch-button__label-top">{TAGLINE}</span>
        <span className="app-switch-button__label-name">{PRODUCT_NAME}</span>
      </span>
    </div>
  );
}
