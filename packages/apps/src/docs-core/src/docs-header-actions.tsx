import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import type { ActionBarAction } from "@/action-bar/src/action-bar";
import { Button, IconButton } from "@/button/src/button";
import { DropdownMenu, type DropdownMenuEntry } from "@/menu-dropdown/src/dropdown-menu";
import {
  DocsPageSetupIcon,
  DocsPageSetupMenu,
  type DocsPageSetupMenuProps,
} from "@/docs-core/src/docs-page-setup-menu";
import { docsPageSetupMenuItems, docsPaperLabel } from "@/docs-core/src/docs-page-setup-menu-items";
import { cn } from "@/lib/utils";

export type DocsHeaderMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export type DocsHeaderAction = ActionBarAction & {
  className?: string;
  /** Wide screens: icon + visible label (Share) instead of icon-only. */
  showLabel?: boolean;
  "data-count"?: number;
  /** A menu instead of a button: a dropdown in the wide row, a submenu in the phone menu. */
  items?: DocsHeaderMenuItem[];
  /** Wide screens: render after `trailing` (review toggle after Suggest). Phones keep it in the menu. */
  placement?: "end";
};

function menuItemEntries(items: readonly DocsHeaderMenuItem[]): DropdownMenuEntry[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon ? (
      <span className="docs-workspace__header-actions-menu-icon">{item.icon}</span>
    ) : undefined,
    onClick: item.onClick,
    disabled: item.disabled,
  }));
}

export type DocsHeaderActionsProps = {
  actions: DocsHeaderAction[];
  menuLabel?: string;
  leading?: ReactNode;
  /** Last in the row at every width (mode switch, e.g. Suggesting). */
  trailing?: ReactNode;
  /** Page setup: first button in the wide-screen row, a submenu in the phone overflow menu. */
  pageSetup?: DocsPageSetupMenuProps;
  className?: string;
};

function actionMenuEntry(action: DocsHeaderAction): DropdownMenuEntry {
  if (action.items) {
    return {
      type: "submenu",
      id: action.id ?? action.label,
      label: action.label,
      icon: <span className="docs-workspace__header-actions-menu-icon">{action.icon}</span>,
      disabled: action.disabled,
      items: menuItemEntries(action.items),
    };
  }
  return {
    id: action.id,
    label: action.label,
    icon: <span className="docs-workspace__header-actions-menu-icon">{action.icon}</span>,
    onClick: action.onClick,
    checked: action.active,
    disabled: action.disabled,
  };
}

function pageSetupMenuEntries({ disabled, ...props }: DocsPageSetupMenuProps): DropdownMenuEntry[] {
  return [
    {
      type: "submenu",
      id: "page-setup",
      label: props.labels.pageSetup,
      icon: (
        <span className="docs-workspace__header-actions-menu-icon">
          <DocsPageSetupIcon pageSetup={props.pageSetup} />
        </span>
      ),
      hint: docsPaperLabel(props.pageSetup.format, props.labels),
      disabled,
      items: docsPageSetupMenuItems(props),
    },
    { type: "separator", id: "after-page-setup" },
  ];
}

function renderActionButton(action: DocsHeaderAction) {
  if (action.items) {
    return (
      <DropdownMenu
        key={action.id ?? action.label}
        align="end"
        sideOffset={10}
        disabled={action.disabled}
        items={menuItemEntries(action.items)}
        contentClassName="min-w-[11rem] p-1.5"
        trigger={
          <IconButton
            label={action.label}
            icon={action.icon}
            size="md"
            variant="outline"
            disabled={action.disabled}
            className={action.className}
          />
        }
      />
    );
  }
  if (action.showLabel) {
    return (
      <Button
        key={action.id ?? action.label}
        label={action.label}
        icon={action.icon}
        onClick={action.onClick}
        disabled={action.disabled}
        size="md"
        variant="outline"
        className={action.className}
      />
    );
  }
  return (
    <IconButton
      key={action.id ?? action.label}
      label={action.label}
      onClick={action.onClick}
      active={action.active}
      disabled={action.disabled}
      icon={action.icon}
      size="md"
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
  trailing,
  pageSetup,
  className,
}: DocsHeaderActionsProps) {
  if (actions.length === 0 && !leading && !trailing) return null;
  const rowActions = actions.filter((action) => action.placement !== "end");
  const endActions = actions.filter((action) => action.placement === "end");

  return (
    <div className={cn("docs-workspace__header-actions", className)}>
      {leading ? <div className="docs-workspace__header-actions-leading">{leading}</div> : null}
      {actions.length > 0 ? (
        <>
          <div className="docs-workspace__header-actions-row">
            {pageSetup ? <DocsPageSetupMenu {...pageSetup} /> : null}
            {rowActions.map(renderActionButton)}
          </div>
          <div className="docs-workspace__header-actions-menu">
            <DropdownMenu
              align="end"
              sideOffset={10}
              items={[
                ...(pageSetup ? pageSetupMenuEntries(pageSetup) : []),
                ...actions.map(actionMenuEntry),
              ]}
              contentClassName="min-w-[11rem] p-1.5"
              trigger={
                <IconButton
                  label={menuLabel}
                  icon={<MoreHorizontal />}
                  variant="outline"
                  size="md"
                  className="docs-workspace__header-actions-menu-trigger"
                />
              }
            />
          </div>
        </>
      ) : null}
      {trailing ? <div className="docs-workspace__header-actions-trailing">{trailing}</div> : null}
      {endActions.length > 0 ? (
        <div className="docs-workspace__header-actions-row docs-workspace__header-actions-row--end">
          {endActions.map(renderActionButton)}
        </div>
      ) : null}
    </div>
  );
}
