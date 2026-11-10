import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "@/button/src/icon-button.css";
import {
  BUTTON_BASE_CLASSNAME,
  BUTTON_ICON_SLOT_CLASSNAME,
  BUTTON_PRESSED_SELECTION_CLASSNAME,
  BUTTON_SEVERITY_CLASSNAMES,
  BUTTON_VARIANT_CLASSNAMES,
  ICON_BUTTON_ACTIVE_CLASSNAME,
  ICON_BUTTON_SIZE_CLASSNAMES,
  type ButtonPressedStyle,
  type ButtonSeverity,
  type ButtonVariant,
  type IconButtonSize,
} from "@/button/src/button.shared";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  variant?: ButtonVariant;
  active?: boolean;
  /** Semantic actions: danger (destructive) or success (resolve/accept) fg + wash. */
  severity?: ButtonSeverity;
  /** Look when active: quiet wash (default) or the suite selection. */
  pressedStyle?: ButtonPressedStyle;
  showTooltip?: boolean;
  tooltipClassName?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    size = "md",
    variant = "outline",
    active = false,
    severity,
    pressedStyle = "wash",
    showTooltip = true,
    tooltipClassName,
    className,
    style,
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        BUTTON_BASE_CLASSNAME,
        ICON_BUTTON_SIZE_CLASSNAMES[size],
        active && ICON_BUTTON_ACTIVE_CLASSNAME,
        BUTTON_VARIANT_CLASSNAMES[variant],
        severity ? BUTTON_SEVERITY_CLASSNAMES[severity] : undefined,
        pressedStyle === "selection" && BUTTON_PRESSED_SELECTION_CLASSNAME,
        className,
      )}
      style={style}
      {...props}
    >
      <span className={BUTTON_ICON_SLOT_CLASSNAME}>{icon}</span>
    </button>
  );

  if (!showTooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent className={tooltipClassName}>{label}</TooltipContent>
    </Tooltip>
  );
});
