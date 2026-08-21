"use client";

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";

import { cn } from "@/lib/utils";

import "./toggle.css";

export type ToggleVariant = "default" | "outline";
export type ToggleSize = "sm" | "md" | "lg" | "default";

export type ToggleVariantsOptions = {
  variant?: ToggleVariant | null;
  size?: ToggleSize | null;
  className?: string;
};

function normalizeToggleSize(size: ToggleSize | null | undefined): "sm" | "md" | "lg" {
  if (size === "sm" || size === "lg") return size;
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
