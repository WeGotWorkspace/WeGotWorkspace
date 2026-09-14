import * as React from "react";
import type { ReactNode } from "react";

import type { ButtonSeverity } from "@/button/src/button.shared";
import { cn } from "@/lib/utils";
import { Switch } from "@/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./segmented-control.css";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  severity?: ButtonSeverity;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Icon-only segments show a tooltip (IconButton pattern). Default true. */
  showTooltip?: boolean;
};

function optionKey<T extends string>(options: SegmentedControlOption<T>[]): string {
  return options.map((option) => option.value).join("\0");
}

function syncSegmentedThumb(root: HTMLElement): void {
  const active = root.querySelector<HTMLElement>(".segmented-control__button--active");
  if (!active) {
    return;
  }
  const rootRect = root.getBoundingClientRect();
  const buttonRect = active.getBoundingClientRect();
  const border = Number.parseFloat(getComputedStyle(root).borderTopWidth) || 0;
  const x = buttonRect.left - rootRect.left - border;
  root.style.setProperty("--segmented-control-thumb-x", `${x}px`);
  root.style.setProperty("--segmented-control-thumb-width", `${buttonRect.width}px`);
  root.dataset.thumbReady = "";
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  disabled = false,
  className,
  "aria-label": ariaLabel,
  showTooltip = true,
}: SegmentedControlProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selectedSeverity = options.find((option) => option.value === value)?.severity;
  const optionsSignature = optionKey(options);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    syncSegmentedThumb(root);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => syncSegmentedThumb(root));
    observer.observe(root);
    for (const button of root.querySelectorAll(".segmented-control__button")) {
      observer.observe(button);
    }
    return () => observer.disconnect();
  }, [value, size, optionsSignature]);

  return (
    <div
      ref={rootRef}
      className={cn("segmented-control", size === "md" && "segmented-control--size-md", className)}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <span
        className={cn(
          "segmented-control__thumb",
          selectedSeverity && `segmented-control__thumb--severity-${selectedSeverity}`,
        )}
        aria-hidden
      />
      {options.map((option) => {
        const active = value === option.value;
        const textOnly = !option.icon;
        const button = (
          <button
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "segmented-control__button",
              textOnly && "segmented-control__button--text",
              active && "segmented-control__button--active",
              option.severity && `segmented-control__button--severity-${option.severity}`,
            )}
          >
            {option.icon ?? <span className="segmented-control__label">{option.label}</span>}
          </button>
        );

        if (textOnly || !showTooltip) {
          return <React.Fragment key={option.value}>{button}</React.Fragment>;
        }

        return (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{option.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export type BooleanSegmentedControlProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  offLabel?: string;
  onLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export const BooleanSegmentedControl = React.forwardRef<
  HTMLButtonElement,
  BooleanSegmentedControlProps
>(function BooleanSegmentedControl(
  {
    value,
    onChange,
    offLabel = "Off",
    onLabel = "On",
    size = "sm",
    disabled = false,
    className,
    "aria-label": ariaLabel,
  },
  ref,
) {
  return (
    <Switch
      ref={ref}
      checked={value}
      onCheckedChange={onChange}
      disabled={disabled}
      size={size}
      className={className}
      aria-label={ariaLabel ?? (value ? onLabel : offLabel)}
    />
  );
});
BooleanSegmentedControl.displayName = "BooleanSegmentedControl";
