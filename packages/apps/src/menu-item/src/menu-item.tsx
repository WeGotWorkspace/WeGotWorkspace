import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import "@/menu-item/src/menu-item.css";

/** Semantic severity for destructive / warning menu rows (hover wash + fg). */
export type MenuItemSeverity = "danger";

export type MenuItemProps = {
  label: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  isDropTarget?: boolean;
  /** When set, fg + hover/focus wash use severity tokens instead of accent/ink. */
  severity?: MenuItemSeverity;
  to?: string;
  className?: string;
  onDragEnter?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

export const MenuItem = React.forwardRef<
  HTMLAnchorElement | HTMLButtonElement | HTMLDivElement,
  MenuItemProps
>(function MenuItem(
  {
    label,
    description,
    icon,
    badge,
    onClick,
    selected,
    checked,
    disabled = false,
    isDropTarget,
    severity,
    to,
    className,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  },
  ref,
) {
  const hasDescription = Boolean(description);
  const interactive =
    !disabled && Boolean(to || onClick || onDragEnter || onDragOver || onDragLeave || onDrop);

  const surfaceClass = isDropTarget
    ? "menu-item--surface-drop"
    : selected
      ? "menu-item--surface-selected"
      : "menu-item--surface-idle";

  const severityClass = severity === "danger" ? "menu-item--severity-danger" : undefined;

  const row = (
    <>
      <span
        className={cn(
          "menu-item__main",
          hasDescription ? "menu-item__main--stacked" : "menu-item__main--compact",
        )}
      >
        {icon != null ? (
          <span aria-hidden className="menu-item__icon-slot">
            {icon}
          </span>
        ) : null}
        <span className="menu-item__text">
          <span className="menu-item__label">{label}</span>
          {hasDescription ? <span className="menu-item__description">{description}</span> : null}
        </span>
      </span>
      {badge != null && badge !== false ? <span className="menu-item__badge">{badge}</span> : null}
      {checked ? <Check className="menu-item__check" aria-hidden /> : null}
    </>
  );

  const sharedClass = cn(
    "menu-item",
    selected && "menu-item--selected",
    disabled && "menu-item--disabled",
    interactive && "menu-item--interactive",
    hasDescription ? "menu-item--align-start" : "menu-item--align-center",
    surfaceClass,
    severityClass,
    className,
  );

  if (to != null) {
    return (
      <Link ref={ref as React.ForwardedRef<HTMLAnchorElement>} to={to} className={sharedClass}>
        {row}
      </Link>
    );
  }

  if (!interactive) {
    return <div className={sharedClass}>{row}</div>;
  }

  return (
    <button
      ref={ref as React.ForwardedRef<HTMLButtonElement>}
      type="button"
      disabled={disabled}
      onClick={onClick}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={sharedClass}
    >
      {row}
    </button>
  );
});

MenuItem.displayName = "MenuItem";
