import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { cn } from "@/lib/utils";

export type DocsHeaderAction = ActionBarAction & {
  className?: string;
  "data-count"?: number;
};

export type DocsHeaderActionsProps = {
  actions: DocsHeaderAction[];
  menuLabel?: string;
  leading?: ReactNode;
  className?: string;
};

function renderActionButton(action: DocsHeaderAction) {
  return (
    <IconButton
      key={action.id ?? action.label}
      label={action.label}
      onClick={action.onClick}
      active={action.active}
      disabled={action.disabled}
      icon={action.icon}
      size="sm"
      variant="outline"
      className={action.className}
      data-count={action["data-count"]}
      aria-pressed={action.active}
    />
  );
}

export function DocsHeaderActions({
  actions,
  menuLabel = "More actions",
  leading,
  className,
}: DocsHeaderActionsProps) {
  if (actions.length === 0 && !leading) return null;

  return (
    <div className={cn("docs-workspace__header-actions", className)}>
      {leading ? <div className="docs-workspace__header-actions-leading">{leading}</div> : null}
      {actions.length > 0 ? (
        <>
          <div className="docs-workspace__header-actions-row">
            {actions.map(renderActionButton)}
          </div>
          <div className="docs-workspace__header-actions-menu">
            <DropdownMenu
              align="end"
              sideOffset={10}
              items={actions.map((action) => ({
                id: action.id,
                label: action.label,
                icon: (
                  <span className="docs-workspace__header-actions-menu-icon">{action.icon}</span>
                ),
                onClick: action.onClick,
                checked: action.active,
                disabled: action.disabled,
              }))}
              contentClassName="min-w-[11rem] p-1.5"
              trigger={
                <IconButton
                  label={menuLabel}
                  icon={<MoreHorizontal />}
                  variant="outline"
                  size="sm"
                  className="docs-workspace__header-actions-menu-trigger"
                />
              }
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
