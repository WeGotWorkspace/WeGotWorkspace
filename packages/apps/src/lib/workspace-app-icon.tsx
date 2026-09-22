import { createContext, memo, useContext, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_APP_ICON_INLINE,
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

/**
 * Optional Storybook / playground override for workspace app (and home) icon SVG markup.
 * Absent provider → production artwork. When `svgMarkup` is set, switch-trigger inlines it
 * and default/tile render it via a `data:` image URL.
 */
export type WorkspaceAppIconOverrideValue = {
  svgMarkup?: string;
};

const WorkspaceAppIconOverrideContext = createContext<WorkspaceAppIconOverrideValue | null>(null);

export function WorkspaceAppIconOverrideProvider({
  svgMarkup,
  children,
}: {
  svgMarkup?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => (svgMarkup ? { svgMarkup } : {}), [svgMarkup]);
  return (
    <WorkspaceAppIconOverrideContext.Provider value={value}>
      {children}
    </WorkspaceAppIconOverrideContext.Provider>
  );
}

function useWorkspaceAppIconOverrideMarkup(): string | undefined {
  return useContext(WorkspaceAppIconOverrideContext)?.svgMarkup;
}

function svgMarkupToDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/**
 * Stable `{ __html }` identities so React never treats a parent re-render as a
 * new dangerouslySetInnerHTML payload (avoids re-parsing the SVG on every poll).
 */
const WORKSPACE_APP_SWITCH_TRIGGER_HTML: Record<WorkspaceAppId, { __html: string }> = {
  admin: { __html: WORKSPACE_APP_ICON_INLINE.admin },
  calendar: { __html: WORKSPACE_APP_ICON_INLINE.calendar },
  contacts: { __html: WORKSPACE_APP_ICON_INLINE.contacts },
  docs: { __html: WORKSPACE_APP_ICON_INLINE.docs },
  drive: { __html: WORKSPACE_APP_ICON_INLINE.drive },
  mail: { __html: WORKSPACE_APP_ICON_INLINE.mail },
  meet: { __html: WORKSPACE_APP_ICON_INLINE.meet },
  notes: { __html: WORKSPACE_APP_ICON_INLINE.notes },
  settings: { __html: WORKSPACE_APP_ICON_INLINE.settings },
  tasks: { __html: WORKSPACE_APP_ICON_INLINE.tasks },
};

const WORKSPACE_HOME_SWITCH_TRIGGER_HTML = { __html: WORKSPACE_HOME_ICON_INLINE };

/** Branded workspace app icon — exact user vector artwork via `/app-icons/{app}.svg`. */
export const WorkspaceAppIcon = memo(function WorkspaceAppIcon({
  appId,
  className,
  variant = "default",
}: WorkspaceAppIconProps) {
  const overrideMarkup = useWorkspaceAppIconOverrideMarkup();
  const overrideHtml = useMemo(
    () => (overrideMarkup ? { __html: overrideMarkup } : null),
    [overrideMarkup],
  );
  const overrideSrc = useMemo(
    () => (overrideMarkup ? svgMarkupToDataUrl(overrideMarkup) : null),
    [overrideMarkup],
  );

  if (variant === "switch-trigger") {
    return (
      <span
        aria-hidden
        className={cn("workspace-app-icon--switch-trigger shrink-0", className)}
        // Same SVG source as default; CSS vars on `.workspace-app-icon--switch-trigger svg` invert layers.
        dangerouslySetInnerHTML={overrideHtml ?? WORKSPACE_APP_SWITCH_TRIGGER_HTML[appId]}
      />
    );
  }

  return (
    <img
      src={overrideSrc ?? workspaceAppIconUiSrc(appId)}
      alt=""
      className={cn(
        "block shrink-0 object-cover",
        variant === "tile" && "workspace-app-icon--tile",
        className,
      )}
      draggable={false}
    />
  );
});

type WorkspaceHomeIconProps = {
  className?: string;
  /** Default: `<img>` of `/app-icons/home.svg`. `switch-trigger`: cream tile + inlined suite mark. */
  variant?: WorkspaceAppIconVariant;
};

/** Branded suite / workspace home icon — exact vector artwork via `/app-icons/home.svg`. */
export const WorkspaceHomeIcon = memo(function WorkspaceHomeIcon({
  className,
  variant = "default",
}: WorkspaceHomeIconProps) {
  const overrideMarkup = useWorkspaceAppIconOverrideMarkup();
  const overrideHtml = useMemo(
    () => (overrideMarkup ? { __html: overrideMarkup } : null),
    [overrideMarkup],
  );
  const overrideSrc = useMemo(
    () => (overrideMarkup ? svgMarkupToDataUrl(overrideMarkup) : null),
    [overrideMarkup],
  );

  if (variant === "switch-trigger") {
    return (
      <span
        aria-hidden
        className={cn(
          "workspace-app-icon--switch-trigger workspace-app-icon--switch-trigger-home shrink-0",
          className,
        )}
        dangerouslySetInnerHTML={overrideHtml ?? WORKSPACE_HOME_SWITCH_TRIGGER_HTML}
      />
    );
  }

  return (
    <img
      src={overrideSrc ?? workspaceHomeIconUiSrc()}
      alt=""
      className={cn("block shrink-0 object-cover", className)}
      draggable={false}
    />
  );
});
