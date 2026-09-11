import { useNavigate, useRouterState } from "@tanstack/react-router";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import { WorkspaceAppIcon, WorkspaceHomeIcon } from "@/lib/workspace-app-icon";
import {
  WORKSPACE_APP_IDS,
  workspaceAppLabel,
  workspaceAppLabelFromPath,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";
import { cn } from "@/lib/utils";
import "@/app-switch-button/src/app-switch-button.css";

const TAGLINE = "we got";
/** Typographic dropdown mark — same font metrics as the app name (not a Lucide glyph). */
const CHEVRON = "▾";

/** Chrome / account apps — listed below a divider, separate from product apps. */
const UTILITY_APP_IDS = new Set<WorkspaceAppId>(["admin", "settings"]);

const WORKSPACE_APPS = WORKSPACE_APP_IDS.map((id) => ({
  id,
  label: workspaceAppLabel(id),
  to: `/${id}` as const,
}));

type WorkspaceAppEntry = (typeof WORKSPACE_APPS)[number];

function byDisplayName(a: WorkspaceAppEntry, b: WorkspaceAppEntry): number {
  return a.label.localeCompare(b.label);
}

const PRODUCT_APPS = WORKSPACE_APPS.filter((app) => !UTILITY_APP_IDS.has(app.id)).sort(
  byDisplayName,
);
const UTILITY_APPS = WORKSPACE_APPS.filter((app) => UTILITY_APP_IDS.has(app.id)).sort(
  byDisplayName,
);

export type AppSwitchButtonVariant = "default" | "compact";

export type AppSwitchButtonProps = {
  disabled?: boolean;
  /** When set (e.g. `Workspace` on home/install), overrides the subtitle inferred from the route. */
  subtitle?: string;
  /** `compact` drops the “we got” tagline and scales the mark to a single app line. */
  variant?: AppSwitchButtonVariant;
  onSelect?: (app: (typeof WORKSPACE_APPS)[number]) => void;
};

export function AppSwitchButton({
  disabled = false,
  subtitle: subtitleProp,
  variant = "default",
  onSelect: onSelectProp,
}: AppSwitchButtonProps) {
  const compact = variant === "compact";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const fromPath = WORKSPACE_APPS.find((a) => path === a.to || path.startsWith(`${a.to}/`));
  const fromSubtitle =
    subtitleProp && subtitleProp !== "Workspace"
      ? WORKSPACE_APPS.find((a) => a.label.toLowerCase() === subtitleProp.toLowerCase())
      : undefined;
  const current = fromSubtitle ?? fromPath ?? WORKSPACE_APPS[0];
  const subtitle = subtitleProp ?? workspaceAppLabelFromPath(path);
  const isWorkspaceContext = subtitleProp === "Workspace";
  const menuSurfaceKey = isWorkspaceContext ? "workspace" : current.id;
  const onSelect =
    onSelectProp ??
    ((app: (typeof WORKSPACE_APPS)[number]) => {
      void navigate({ to: app.to });
    });

  const toMenuItem = (app: WorkspaceAppEntry): DropdownMenuEntry => ({
    id: app.id,
    label: app.label,
    icon: (
      <WorkspaceAppIcon
        appId={app.id as WorkspaceAppId}
        className="app-switch-button__menu-icon size-4"
      />
    ),
    checked: app.id === current.id,
    onClick: () => {
      if (disabled || app.id === current.id) return;
      onSelect?.(app);
    },
  });

  const menuItems: DropdownMenuEntry[] = [
    ...PRODUCT_APPS.map(toMenuItem),
    ...(PRODUCT_APPS.length > 0 && UTILITY_APPS.length > 0
      ? [{ type: "separator" as const, id: "app-switch-utility-sep" }]
      : []),
    ...UTILITY_APPS.map(toMenuItem),
  ];

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "app-switch-button__trigger",
            compact && "app-switch-button__trigger--compact",
            isWorkspaceContext && "app-switch-button__trigger--workspace",
          )}
        >
          {isWorkspaceContext ? (
            <WorkspaceHomeIcon className="app-switch-button__icon" variant="switch-trigger" />
          ) : (
            <WorkspaceAppIcon
              appId={current.id as WorkspaceAppId}
              className="app-switch-button__icon"
              variant="switch-trigger"
            />
          )}
          <span className="app-switch-button__label">
            {!compact ? <span className="app-switch-button__label-top">{TAGLINE}</span> : null}
            <span className="app-switch-button__label-name">
              {subtitle}
              {!disabled ? (
                <span className="app-switch-button__chevron" aria-hidden>
                  {CHEVRON}
                </span>
              ) : null}
            </span>
          </span>
        </button>
      }
      items={menuItems}
      disabled={disabled}
      contentClassName={cn("app-switch-button__menu", `app-switch-button__menu--${menuSurfaceKey}`)}
    />
  );
}
