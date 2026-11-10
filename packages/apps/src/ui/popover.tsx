import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { bridgePortalThemeFromOpenTrigger } from "@/ui/portal-theme-vars";
import "@/ui/overlay-paper.css";
// The frost recipe (`.popover-ui--frost`) sits with the select list styles.
import "@/ui/input.css";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

export type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  /** Frosted floating chrome, as the dropdown and select menus (suite norm). */
  frost?: boolean;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, frost = false, ...props }, ref) => {
  const contentRef = React.useRef<React.ElementRef<typeof PopoverPrimitive.Content> | null>(null);

  const assignContentRef = React.useCallback(
    (node: React.ElementRef<typeof PopoverPrimitive.Content> | null) => {
      contentRef.current = node;
      // The frost tints over the trigger's paper, handed over as `--workspace-surface`.
      if (node && frost) bridgePortalThemeFromOpenTrigger(node, { frost: true });
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref, frost],
  );

  React.useLayoutEffect(() => {
    const content = contentRef.current;
    if (content && frost) bridgePortalThemeFromOpenTrigger(content, { frost: true });
  }, [frost]);

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={assignContentRef}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "overlay-paper z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-popover-content-transform-origin)",
          frost && "popover-ui--frost",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
