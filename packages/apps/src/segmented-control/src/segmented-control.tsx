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
  /**
   * When true with an `icon`, render the label beside the icon.
   * Omit (default) for icon-only segments that use `label` for aria/tooltip only.
   * Text-only segments omit `icon` and always show `label`.
   */
  showLabel?: boolean;
  severity?: ButtonSeverity;
};

export type SegmentedControlProps<T extends string> = {
  /** Selected option, or `null` for an action group with nothing chosen yet. */
  value: T | null;
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

/**
 * Sync thumb geometry to the active segment.
 *
 * Contract: the first layout (and any layout while the thumb was unselected)
 * writes position/width without enabling motion. `data-thumb-animate` is set
 * only after that snap has painted, so remounting a card with a selected value
 * never replays a slide-in from the parked/zero thumb. Later option changes
 * animate transform only (see CSS).
 */
function syncSegmentedThumb(
  root: HTMLElement,
  options: { allowAnimate: boolean; onReady: () => void },
): void {
  const active = root.querySelector<HTMLElement>(".segmented-control__button--active");
  if (!active) {
    delete root.dataset.thumbReady;
    delete root.dataset.thumbAnimate;
    return;
  }
  const rootRect = root.getBoundingClientRect();
  const buttonRect = active.getBoundingClientRect();
  const border = Number.parseFloat(getComputedStyle(root).borderTopWidth) || 0;
  const x = buttonRect.left - rootRect.left - border;
  root.style.setProperty("--segmented-control-thumb-x", `${x}px`);
  root.style.setProperty("--segmented-control-thumb-width", `${buttonRect.width}px`);
  root.dataset.thumbReady = "";
  if (options.allowAnimate) {
    root.dataset.thumbAnimate = "";
  } else {
    delete root.dataset.thumbAnimate;
  }
  options.onReady();
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
  const hasAnimatedRef = React.useRef(false);
  const hasSelection = value != null;
  const selectedSeverity = hasSelection
    ? options.find((option) => option.value === value)?.severity
    : undefined;
  const optionsSignature = optionKey(options);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    if (!hasSelection) {
      hasAnimatedRef.current = false;
    }

    let cancelled = false;
    let outerFrame = 0;
    let innerFrame = 0;
    const runSync = () => {
      const allowAnimate = hasAnimatedRef.current;
      syncSegmentedThumb(root, {
        allowAnimate,
        onReady: () => {
          if (allowAnimate || !root.hasAttribute("data-thumb-ready") || cancelled) {
            return;
          }
          // Enable motion only after the snapped first layout has painted.
          cancelAnimationFrame(outerFrame);
          cancelAnimationFrame(innerFrame);
          outerFrame = requestAnimationFrame(() => {
            innerFrame = requestAnimationFrame(() => {
              if (
                cancelled ||
                !root.isConnected ||
                !root.querySelector(".segmented-control__button--active")
              ) {
                return;
              }
              hasAnimatedRef.current = true;
              root.dataset.thumbAnimate = "";
            });
          });
        },
      });
    };

    runSync();
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
        cancelAnimationFrame(outerFrame);
        cancelAnimationFrame(innerFrame);
      };
    }
    const observer = new ResizeObserver(() => runSync());
    observer.observe(root);
    for (const button of root.querySelectorAll(".segmented-control__button")) {
      observer.observe(button);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(outerFrame);
      cancelAnimationFrame(innerFrame);
      observer.disconnect();
    };
  }, [value, size, optionsSignature, hasSelection]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "segmented-control",
        size === "md" && "segmented-control--size-md",
        !hasSelection && "segmented-control--unselected",
        className,
      )}
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
        const active = hasSelection && value === option.value;
        const hasIcon = option.icon != null;
        const showVisibleLabel = !hasIcon || Boolean(option.showLabel);
        const iconOnly = hasIcon && !option.showLabel;
        const button = (
          <button
            type="button"
            aria-label={option.label}
            aria-pressed={hasSelection ? active : undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "segmented-control__button",
              showVisibleLabel && "segmented-control__button--text",
              active && "segmented-control__button--active",
              option.severity && `segmented-control__button--severity-${option.severity}`,
            )}
          >
            {option.icon}
            {showVisibleLabel ? (
              <span className="segmented-control__label">{option.label}</span>
            ) : null}
          </button>
        );

        if (!iconOnly || !showTooltip) {
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
