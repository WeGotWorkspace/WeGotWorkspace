import type { ReactNode } from "react";
import { ArrowLeft, MoreHorizontal, X } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { cn } from "@/lib/utils";
import "@/action-bar/src/action-bar.css";

export type ActionBarAction = {
  id?: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
};

export type ActionBarProps = {
  /** Shown only below the `md` breakpoint; typically closes the mobile detail stack. */
  onBack?: () => void;
  backLabel?: string;
  /** Back arrow for stacked mobile detail; close (X) for side panels and dialogs. */
  backIcon?: "back" | "close";
  /** When false, always render inline actions instead of the compact overflow menu. */
  collapseActions?: boolean;
  /** Preferred API: action descriptors rendered by ActionBar with compact dropdown behavior. */
  leftActions?: ActionBarAction[];
  /** Preferred API: action descriptors rendered by ActionBar with compact dropdown behavior. */
  rightActions?: ActionBarAction[];
  /**
   * Optional leading content before right actions (e.g. collab presence), matching
   * docs header `leading` slot order: presence then actions.
   */
  rightLeading?: ReactNode;
  leftMenuLabel?: string;
  rightMenuLabel?: string;
  leftMenuIcon?: ReactNode;
  rightMenuIcon?: ReactNode;
  /** Primary actions (e.g. reply), placed after the back control on small screens. */
  left?: React.ReactNode;
  /** Secondary actions (e.g. archive), aligned to the trailing edge. */
  right?: React.ReactNode;
  className?: string;
};

function renderActionItems(actions: ActionBarAction[]) {
  return actions.map((action) => (
    <IconButton
      key={action.id ?? action.label}
      label={action.label}
      onClick={action.onClick}
      active={action.active}
      disabled={action.disabled}
      icon={action.icon}
      variant="subtle"
    />
  ));
}

function renderCompactDropdown(
  actions: ActionBarAction[],
  label: string,
  icon: ReactNode,
  align: "start" | "end",
  className: string,
) {
  return (
    <div className={className}>
      <DropdownMenu
        align={align}
        sideOffset={10}
        items={actions.map((action) => ({
          id: action.id,
          label: action.label,
          icon: <span className="action-bar__menu-item-icon">{action.icon}</span>,
          onClick: action.onClick,
          checked: action.active,
          disabled: action.disabled,
        }))}
        contentClassName="min-w-[11rem] p-1.5"
        trigger={
          <IconButton
            label={label}
            icon={icon}
            variant="subtle"
            className="action-bar__menu-trigger"
          />
        }
      />
    </div>
  );
}

export function ActionBar({
  onBack,
  backLabel = "Back",
  backIcon = "back",
  collapseActions = true,
  leftActions,
  rightActions,
  rightLeading,
  leftMenuLabel = "More actions",
  rightMenuLabel = "More actions",
  leftMenuIcon = <MoreHorizontal />,
  rightMenuIcon = <MoreHorizontal />,
  left,
  right,
  className,
}: ActionBarProps) {
  const hasLeftActions = (leftActions?.length ?? 0) > 0;
  const hasRightActions = (rightActions?.length ?? 0) > 0;
  const hasRightChrome = hasRightActions || right != null || rightLeading != null;

  return (
    <nav className={cn("action-bar", !collapseActions && "action-bar--expanded", className)}>
      {onBack ? (
        <IconButton
          label={backLabel}
          onClick={onBack}
          icon={backIcon === "close" ? <X /> : <ArrowLeft />}
          variant="ghost"
          className="action-bar__back"
        />
      ) : null}
      {hasLeftActions ? (
        <div className="action-bar__left">
          <div className="action-bar__row">{renderActionItems(leftActions!)}</div>
          {renderCompactDropdown(
            leftActions!,
            leftMenuLabel,
            leftMenuIcon,
            "start",
            "action-bar__menu",
          )}
        </div>
      ) : left != null ? (
        <div className="action-bar__left">{left}</div>
      ) : null}
      <div className="action-bar__spacer" />
      {hasRightChrome ? (
        <div className="action-bar__right">
          {rightLeading != null ? (
            <div className="action-bar__right-leading">{rightLeading}</div>
          ) : null}
          {hasRightActions ? (
            <>
              <div className="action-bar__row">{renderActionItems(rightActions!)}</div>
              {renderCompactDropdown(
                rightActions!,
                rightMenuLabel,
                rightMenuIcon,
                "end",
                "action-bar__menu",
              )}
            </>
          ) : right != null ? (
            right
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
