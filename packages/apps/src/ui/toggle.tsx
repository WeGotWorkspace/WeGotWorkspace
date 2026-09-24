"use client";

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";

import { cn } from "@/lib/utils";
import { CONTROL_SIZE_OPTIONS, type ControlSize } from "@/ui/control-size";

import "./toggle.css";

export type ToggleVariant = "default" | "outline";
export type ToggleSize = ControlSize | "default";

export type ToggleVariantsOptions = {
  variant?: ToggleVariant | null;
  size?: ToggleSize | null;
  className?: string;
};

function normalizeToggleSize(size: ToggleSize | null | undefined): ControlSize {
  if (size && size !== "default" && (CONTROL_SIZE_OPTIONS as readonly string[]).includes(size)) {
    return size;
  }
  return "md";
}

/** Class-name helper for {@link Toggle} and {@link ToggleGroupItem}. */
export function toggleVariants({ variant, size, className }: ToggleVariantsOptions = {}): string {
  const normalizedSize = normalizeToggleSize(size);
  return cn(
    "toggle",
    `toggle--size-${normalizedSize}`,
    variant === "outline" && "toggle--outline",
    className,
  );
}

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & ToggleVariantsOptions
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={toggleVariants({ variant, size, className })}
    {...props}
  />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle };
