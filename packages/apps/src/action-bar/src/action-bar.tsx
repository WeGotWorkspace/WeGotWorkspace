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
   * With `showLabel`, keep the visible label on a wide bar and drop it on a
   * small screen (same 767px cutoff as `collapseOnNarrow`). The accessible
   * name stays `aria-label`.
   */
  iconOnlyOnNarrow?: boolean;
  /**
   * Destructive outline wash on the inline IconButton and overflow menu item
   * (e.g. Delete → `button--severity-danger`).
   */
  severity?: ButtonSeverity;
  /**
   * Stay inline on a wide bar. On a small screen (collection detail overlay,
   * max-width 767px) hide the button and list the action in the overflow menu.
   */
  collapseOnNarrow?: boolean;
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
   * When false, always render every action inline (no More menu) and ignore
   * `collapseOnNarrow`, so those buttons stay on screen.
   * When true (default), actions past {@link ACTION_BAR_MAX_INLINE_ACTIONS}
   * move into the More menu. Actions marked `collapseOnNarrow` stay inline on
   * a wide bar and join the menu below 768px.
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

type ActionBarSplit = {
  inline: ActionBarAction[];
  /** Count overflow. Shown at every width unless a narrow menu also exists. */
  wideMenu: ActionBarAction[];
  /** Small-screen menu. Original order: count overflow and `collapseOnNarrow`. */
  narrowMenu: ActionBarAction[];
};

function partitionActions(actions: ActionBarAction[], collapseActions: boolean): ActionBarSplit {
  if (!collapseActions) {
    return {
      inline: actions.map((action) => ({ ...action, collapseOnNarrow: false })),
      wideMenu: [],
      narrowMenu: [],
    };
  }
  const inline =
    actions.length <= ACTION_BAR_MAX_INLINE_ACTIONS
      ? actions
      : actions.slice(0, ACTION_BAR_MAX_INLINE_ACTIONS);
  const countOverflow =
    actions.length <= ACTION_BAR_MAX_INLINE_ACTIONS
      ? []
      : actions.slice(ACTION_BAR_MAX_INLINE_ACTIONS);
  const hasNarrow = inline.some((action) => action.collapseOnNarrow);
  if (countOverflow.length > 0 && hasNarrow) {
    return {
      inline,
      wideMenu: countOverflow,
      narrowMenu: actions.filter(
        (action, index) =>
          index >= ACTION_BAR_MAX_INLINE_ACTIONS || Boolean(action.collapseOnNarrow),
      ),
    };
  }
  if (hasNarrow) {
    return {
      inline,
      wideMenu: [],
      narrowMenu: inline.filter((action) => action.collapseOnNarrow),
    };
  }
  return { inline, wideMenu: countOverflow, narrowMenu: [] };
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
              size="md"
              variant="outline"
              aria-label={tooltipLabel}
              aria-pressed={action.active}
              className={cn(
                "action-bar__action--labeled",
                action.iconOnlyOnNarrow && "action-bar__action--icon-narrow",
                action.collapseOnNarrow && "action-bar__action--collapse-narrow",
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
        size="md"
        variant="outline"
        className={cn(action.collapseOnNarrow && "action-bar__action--collapse-narrow")}
      />
    );
  });
}

function renderRightLeading(rightLeading: ReactNode) {
  return <div className="action-bar__right-leading">{rightLeading}</div>;
}

function renderActionRow(actions: ActionBarAction[]) {
  if (actions.length === 0) return null;
  const collapseRow = actions.every((action) => action.collapseOnNarrow);
  return (
    <div className={cn("action-bar__row", collapseRow && "action-bar__row--collapse-narrow")}>
      {renderActionItems(actions)}
    </div>
  );
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
        {renderActionRow(inline.slice(0, 1))}
        {leading}
        {inline.length > 1 ? renderActionRow(inline.slice(1)) : null}
      </>
    );
  }
  return (
    <>
      {placement === "start" ? leading : null}
      {renderActionRow(inline)}
      {placement === "after-first" ? leading : null}
    </>
  );
}

function renderSideMenus({
  wideMenu,
  narrowMenu,
  label,
  icon,
  align,
}: {
  wideMenu: ActionBarAction[];
  narrowMenu: ActionBarAction[];
  label: string;
  icon: ReactNode;
  align: "start" | "end";
}) {
  const both = wideMenu.length > 0 && narrowMenu.length > 0;
  return (
    <>
      {wideMenu.length > 0
        ? renderCompactDropdown(
            wideMenu,
            label,
            icon,
            align,
            cn("action-bar__menu", both && "action-bar__menu--wide"),
          )
        : null}
      {narrowMenu.length > 0
        ? renderCompactDropdown(
            narrowMenu,
            label,
            icon,
            align,
            "action-bar__menu action-bar__menu--narrow",
          )
        : null}
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
          severity: action.severity === "danger" ? ("danger" as const) : undefined,
        }))}
        contentClassName="min-w-[11rem] p-1.5"
        trigger={
          <IconButton
            label={label}
            icon={icon}
            size="md"
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
  const leftSplit = hasLeftActions ? partitionActions(leftActions!, collapseActions) : null;
  const rightSplit = hasRightActions ? partitionActions(rightActions!, collapseActions) : null;

  return (
    <nav className={cn("action-bar", !collapseActions && "action-bar--expanded", className)}>
      {onBack ? (
        <Button
          label={backLabel}
          onClick={onBack}
          icon={backIcon === "close" ? <X /> : <ArrowLeft />}
          variant="outline"
          className="action-bar__back"
          size="md"
          title={backLabel}
        />
      ) : null}
      {leftSplit ? (
        <div className="action-bar__left">
          {renderActionRow(leftSplit.inline)}
          {renderSideMenus({
            wideMenu: leftSplit.wideMenu,
            narrowMenu: leftSplit.narrowMenu,
            label: leftMenuLabel,
            icon: leftMenuIcon,
            align: "start",
          })}
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
              {renderSideMenus({
                wideMenu: rightSplit.wideMenu,
                narrowMenu: rightSplit.narrowMenu,
                label: rightMenuLabel,
                icon: rightMenuIcon,
                align: "end",
              })}
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
