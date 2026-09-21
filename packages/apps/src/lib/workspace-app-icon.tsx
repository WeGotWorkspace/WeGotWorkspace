import { cn } from "@/lib/utils";
import {
  workspaceAppIconInlineMarkup,
  WORKSPACE_HOME_ICON_INLINE,
} from "@/lib/workspace-app-icon-svgs";
import {
  workspaceAppIconUiSrc,
  workspaceHomeIconUiSrc,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";
import "@/lib/workspace-app-icon.css";

export type WorkspaceAppIconVariant = "default" | "switch-trigger" | "tile";

type WorkspaceAppIconProps = {
  appId: WorkspaceAppId;
  className?: string;
  /** `switch-trigger` inverts colors for the app-switch lockup; `tile` fills the home grid cell. */
  variant?: WorkspaceAppIconVariant;
};

/** Branded workspace app icon — exact user vector artwork via `/app-icons/{app}.svg`. */
export function WorkspaceAppIcon({ appId, className, variant = "default" }: WorkspaceAppIconProps) {
  if (variant === "switch-trigger") {
    return (
      <span
        aria-hidden
        className={cn("workspace-app-icon--switch-trigger shrink-0", className)}
        // Same SVG source as default; CSS vars on `.workspace-app-icon--switch-trigger svg` invert layers.
        dangerouslySetInnerHTML={{ __html: workspaceAppIconInlineMarkup(appId) }}
      />
    );
  }

  return (
    <img
      src={workspaceAppIconUiSrc(appId)}
      alt=""
      className={cn(
        "block shrink-0 object-cover",
        variant === "tile" && "workspace-app-icon--tile",
        className,
      )}
      draggable={false}
    />
  );
}

type WorkspaceHomeIconProps = {
  className?: string;
  /** Default: `<img>` of `/app-icons/home.svg`. `switch-trigger`: cream tile + inlined suite mark. */
  variant?: WorkspaceAppIconVariant;
};

/** Branded suite / workspace home icon — exact vector artwork via `/app-icons/home.svg`. */
export function WorkspaceHomeIcon({ className, variant = "default" }: WorkspaceHomeIconProps) {
  if (variant === "switch-trigger") {
    return (
      <span
        aria-hidden
        className={cn(
          "workspace-app-icon--switch-trigger workspace-app-icon--switch-trigger-home shrink-0",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: WORKSPACE_HOME_ICON_INLINE }}
      />
    );
  }

  return (
    <img
      src={workspaceHomeIconUiSrc()}
      alt=""
      className={cn("block shrink-0 object-cover", className)}
      draggable={false}
    />
  );
}
