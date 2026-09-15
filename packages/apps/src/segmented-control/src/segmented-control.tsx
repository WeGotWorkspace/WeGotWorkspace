import * as React from "react";
import type { ReactNode } from "react";

import type { ButtonSeverity } from "@/button/src/button.shared";
import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";
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
  /** Default `md` = 36px (chrome density). */
  size?: ControlSize;
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
 * Contract: layout writes x/width/height immediately, but `data-thumb-ready`
 * (opacity) waits for a post-paint remeasure so the wash never flashes at a
 * stale or border-box-tall size. `data-thumb-animate` is set only after that
 * reveal, so remounting a card with a selected value never replays a slide-in.
 * Later option changes animate transform only (see CSS).
 *
 * Height uses `clientHeight` (content box) — not border-box — so the wash
 * cannot paint past the track top/bottom on first layout.
 */
function syncSegmentedThumb(
  root: HTMLElement,
  options: { allowAnimate: boolean; reveal: boolean },
): void {
  const active = root.querySelector<HTMLElement>(".segmented-control__button--active");
  if (!active) {
    delete root.dataset.thumbReady;
    delete root.dataset.thumbAnimate;
    root.style.removeProperty("--segmented-control-thumb-x");
    root.style.removeProperty("--segmented-control-thumb-width");
    root.style.removeProperty("--segmented-control-thumb-height");
    return;
  }
  const rootRect = root.getBoundingClientRect();
  const buttonRect = active.getBoundingClientRect();
  const border = Number.parseFloat(getComputedStyle(root).borderTopWidth) || 0;
  // Thumb `left: 0` is the padding edge; rootRect is the border box.
  // Round to device pixels so labeled end segments do not overhang the track by a hair.
  const x = Math.round(buttonRect.left - rootRect.left - border);
  const width = Math.round(buttonRect.width);
  const height = Math.round(root.clientHeight);
  root.style.setProperty("--segmented-control-thumb-x", `${x}px`);
  root.style.setProperty("--segmented-control-thumb-width", `${width}px`);
  root.style.setProperty("--segmented-control-thumb-height", `${height}px`);
  // Reveal after the caller’s post-paint remeasure — do not gate on measured
  // size (jsdom often reports 0×0; real layouts settle before double-rAF).
  if (options.reveal) {
    root.dataset.thumbReady = "";
  }
  if (options.allowAnimate) {
    root.dataset.thumbAnimate = "";
  } else {
    delete root.dataset.thumbAnimate;
  }
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
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
    const runSync = (reveal: boolean) => {
      syncSegmentedThumb(root, {
        allowAnimate: hasAnimatedRef.current,
        reveal,
      });
    };

    // Measure now but keep the wash hidden until post-paint remeasure.
    runSync(false);
    cancelAnimationFrame(outerFrame);
    cancelAnimationFrame(innerFrame);
    outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (cancelled || !root.isConnected) {
          return;
        }
        runSync(true);
        if (
          cancelled ||
          !root.hasAttribute("data-thumb-ready") ||
          !root.querySelector(".segmented-control__button--active")
        ) {
          return;
        }
        hasAnimatedRef.current = true;
        root.dataset.thumbAnimate = "";
      });
    });
    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
        cancelAnimationFrame(outerFrame);
        cancelAnimationFrame(innerFrame);
      };
    }
    const observer = new ResizeObserver(() => {
      // Keep geometry fresh; only reveal if the wash is already visible so
      // ResizeObserver cannot flash a pre-paint thumb on first layout.
      runSync(root.hasAttribute("data-thumb-ready"));
    });
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
        controlSizeClassName("segmented-control", size),
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
      {options.map((option, index) => {
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
              index === 0 && "segmented-control__button--first",
              index === options.length - 1 && "segmented-control__button--last",
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
