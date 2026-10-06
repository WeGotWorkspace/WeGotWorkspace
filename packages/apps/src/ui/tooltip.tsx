"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { bridgePortalThemeFromOpenTrigger } from "@/ui/portal-theme-vars";
import "@/ui/tooltip.css";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const assignContentRef = React.useCallback(
    (node: React.ElementRef<typeof TooltipPrimitive.Content> | null) => {
      if (node) bridgePortalThemeFromOpenTrigger(node, { paintSurface: false });
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={assignContentRef}
        sideOffset={sideOffset}
        className={cn("tooltip-ui", className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
