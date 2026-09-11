import type { ReactNode } from "react";
import { ArrowLeft, MoreHorizontal, X } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { ICON_BUTTON_ACTIVE_CLASSNAME, type ButtonSeverity } from "@/button/src/button.shared";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import "@/action-bar/src/action-bar.css";

/** Max actions shown inline before the More (`…`) overflow menu appears. */
export const ACTION_BAR_MAX_INLINE_ACTIONS = 3;

export type ActionBarAction = {
  id?: string;
  label: string;
  /**
   * Tooltip / accessible name when it should differ from the visible `label`
   * (e.g. notebook name visible, “Change notebook” in the tooltip).
   */
  tooltip?: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** When true, render icon + visible label (Button) instead of icon-only IconButton. */
  showLabel?: boolean;
  /**
   * Destructive outline wash on the inline IconButton and overflow menu item
   * (e.g. Delete → `button--severity-danger`).
   */
  severity?: ButtonSeverity;
};

export type ActionBarRightLeadingPlacement = "start" | "after-first";

export type ActionBarProps = {
  /** Shown only below the `md` breakpoint; typically closes the mobile detail stack. */
  onBack?: () => void;
  /** Visible truncated label on the back control (list / view title). Defaults to “Back”. */
  backLabel?: string;
  /** Back arrow for stacked mobile detail; close (X) for side panels and dialogs. */
  backIcon?: "back" | "close";
  /**
   * When false, always render every action inline (no More menu).
   * When true (default), overflow kicks in only when a side has more than
   * {@link ACTION_BAR_MAX_INLINE_ACTIONS} actions (first N inline, rest in More).
   */
  collapseActions?: boolean;
  /** Preferred API: action descriptors rendered by ActionBar with compact dropdown behavior. */
  leftActions?: ActionBarAction[];
  /** Preferred API: action descriptors rendered by ActionBar with compact dropdown behavior. */
  rightActions?: ActionBarAction[];
  /**
   * Optional leading content beside right actions (e.g. notebook / address-book switcher).
   * Placement defaults to before all actions (`start`).
   */
  rightLeading?: ReactNode;
  /**
   * Where to put {@link rightLeading} relative to {@link rightActions}.
   * `after-first` pins the first right action leftmost (e.g. Contacts Edit), then the leading slot.
   */
  rightLeadingPlacement?: ActionBarRightLeadingPlacement;
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

function splitInlineAndOverflow(
  actions: ActionBarAction[],
  collapseActions: boolean,
): { inline: ActionBarAction[]; overflow: ActionBarAction[] } {
  if (!collapseActions || actions.length <= ACTION_BAR_MAX_INLINE_ACTIONS) {
    return { inline: actions, overflow: [] };
  }
  return {
    inline: actions.slice(0, ACTION_BAR_MAX_INLINE_ACTIONS),
    overflow: actions.slice(ACTION_BAR_MAX_INLINE_ACTIONS),
  };
}

function renderActionItems(actions: ActionBarAction[]) {
  return actions.map((action) => {
    const tooltipLabel = action.tooltip ?? action.label;
    if (action.showLabel) {
      return (
        <Tooltip key={action.id ?? action.label}>
          <TooltipTrigger asChild>
            <Button
              label={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              icon={action.icon}
              size="sm"
              variant="outline"
              aria-label={tooltipLabel}
              aria-pressed={action.active}
              className={cn(
                "action-bar__action--labeled",
                action.active && ICON_BUTTON_ACTIVE_CLASSNAME,
              )}
            />
          </TooltipTrigger>
          <TooltipContent>{tooltipLabel}</TooltipContent>
        </Tooltip>
      );
    }
    return (
      <IconButton
        key={action.id ?? action.label}
        label={tooltipLabel}
        onClick={action.onClick}
        active={action.active}
        disabled={action.disabled}
        severity={action.severity}
        icon={action.icon}
        size="sm"
        variant="outline"
      />
    );
  });
}

function renderRightLeading(rightLeading: ReactNode) {
  return <div className="action-bar__right-leading">{rightLeading}</div>;
}

function renderRightInlineWithLeading({
  inline,
  rightLeading,
  placement,
}: {
  inline: ActionBarAction[];
  rightLeading: ReactNode | undefined;
  placement: ActionBarRightLeadingPlacement;
}) {
  const leading = rightLeading != null ? renderRightLeading(rightLeading) : null;
  if (placement === "after-first" && inline.length > 0 && leading != null) {
    return (
      <>
        <div className="action-bar__row">{renderActionItems(inline.slice(0, 1))}</div>
        {leading}
        {inline.length > 1 ? (
          <div className="action-bar__row">{renderActionItems(inline.slice(1))}</div>
        ) : null}
      </>
    );
  }
  return (
    <>
      {placement === "start" ? leading : null}
      <div className="action-bar__row">{renderActionItems(inline)}</div>
      {placement === "after-first" ? leading : null}
    </>
  );
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
          severity: action.severity,
        }))}
        contentClassName="min-w-[11rem] p-1.5"
        trigger={
          <IconButton
            label={label}
            icon={icon}
            size="sm"
            variant="outline"
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
  rightLeadingPlacement = "start",
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
  const leftSplit = hasLeftActions ? splitInlineAndOverflow(leftActions!, collapseActions) : null;
  const rightSplit = hasRightActions
    ? splitInlineAndOverflow(rightActions!, collapseActions)
    : null;

  return (
    <nav className={cn("action-bar", !collapseActions && "action-bar--expanded", className)}>
      {onBack ? (
        <Button
          label={backLabel}
          onClick={onBack}
          icon={backIcon === "close" ? <X /> : <ArrowLeft />}
          variant="outline"
          className="action-bar__back"
          size="sm"
          title={backLabel}
        />
      ) : null}
      {leftSplit ? (
        <div className="action-bar__left">
          <div className="action-bar__row">{renderActionItems(leftSplit.inline)}</div>
          {leftSplit.overflow.length > 0
            ? renderCompactDropdown(
                leftSplit.overflow,
                leftMenuLabel,
                leftMenuIcon,
                "start",
                "action-bar__menu",
              )
            : null}
        </div>
      ) : left != null ? (
        <div className="action-bar__left">{left}</div>
      ) : null}
      <div className="action-bar__spacer" />
      {hasRightChrome ? (
        <div className="action-bar__right">
          {rightSplit ? (
            <>
              {renderRightInlineWithLeading({
                inline: rightSplit.inline,
                rightLeading,
                placement: rightLeadingPlacement,
              })}
              {rightSplit.overflow.length > 0
                ? renderCompactDropdown(
                    rightSplit.overflow,
                    rightMenuLabel,
                    rightMenuIcon,
                    "end",
                    "action-bar__menu",
                  )
                : null}
            </>
          ) : (
            <>
              {rightLeading != null && rightLeadingPlacement === "start"
                ? renderRightLeading(rightLeading)
                : null}
              {right != null ? right : null}
              {rightLeading != null && rightLeadingPlacement === "after-first"
                ? renderRightLeading(rightLeading)
                : null}
            </>
          )}
        </div>
      ) : null}
    </nav>
  );
}
