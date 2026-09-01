import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import type { DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { WorkspaceAppIcon, WorkspaceHomeIcon } from "@/lib/workspace-app-icon";
import { WORKSPACE_APP_IDS, type WorkspaceAppId } from "@/lib/workspace-app-icons";
import { cn } from "@/lib/utils";
import "@/app-switch-button/src/app-switch-button.css";

const TAGLINE = "we got";

const WORKSPACE_APPS = WORKSPACE_APP_IDS.map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  to: `/${id}` as const,
}));

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
  const subtitle = subtitleProp ?? current.label;
  const isWorkspaceContext = subtitleProp === "Workspace";
  const menuSurfaceKey = isWorkspaceContext ? "workspace" : current.id;
  const onSelect =
    onSelectProp ??
    ((app: (typeof WORKSPACE_APPS)[number]) => {
      void navigate({ to: app.to });
    });

  const menuItems: DropdownMenuItemProps[] = WORKSPACE_APPS.map((app) => ({
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
  }));

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
            <span>{subtitle}</span>
          </span>
          {!disabled ? (
            <span className="app-switch-button__chevron-stack">
              <span aria-hidden />
              <ChevronDown className="app-switch-button__chevron" aria-hidden />
            </span>
          ) : null}
        </button>
      }
      items={menuItems}
      disabled={disabled}
      contentClassName={cn("app-switch-button__menu", `app-switch-button__menu--${menuSurfaceKey}`)}
    />
  );
}
