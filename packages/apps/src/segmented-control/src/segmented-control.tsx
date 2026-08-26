import * as React from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import "./segmented-control.css";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn("segmented-control", size === "md" && "segmented-control--size-md", className)}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? "" : undefined}
    >
      {options.map((option) => {
        const active = value === option.value;
        const textOnly = !option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "segmented-control__button",
              textOnly && "segmented-control__button--text",
              active && "segmented-control__button--active",
            )}
          >
            {option.icon ?? <span className="segmented-control__label">{option.label}</span>}
          </button>
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
  HTMLDivElement,
  BooleanSegmentedControlProps
>(function BooleanSegmentedControl(
  {
    value,
    onChange,
    offLabel = "Off",
    onLabel = "On",
    size: _size = "sm",
    disabled = false,
    className,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const state = value ? "on" : "off";

  return (
    <div
      ref={ref}
      className={cn("segmented-control", "segmented-control--boolean", className)}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-state={state}
      data-disabled={disabled ? "" : undefined}
    >
      <button
        type="button"
        className="segmented-control__thumb"
        data-state={state}
        disabled={disabled}
        aria-label={value ? onLabel : offLabel}
        onClick={() => onChange(!value)}
      />
      <button
        type="button"
        aria-label={offLabel}
        aria-pressed={!value}
        disabled={disabled}
        onClick={() => onChange(false)}
        className="segmented-control__button segmented-control__button--boolean"
      />
      <button
        type="button"
        aria-label={onLabel}
        aria-pressed={value}
        disabled={disabled}
        onClick={() => onChange(true)}
        className="segmented-control__button segmented-control__button--boolean"
      />
    </div>
  );
});
BooleanSegmentedControl.displayName = "BooleanSegmentedControl";
