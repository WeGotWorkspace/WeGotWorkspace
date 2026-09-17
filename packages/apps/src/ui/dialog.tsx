"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { DialogCloseButton } from "@/ui/dialog-close-button";
import { withNestedLayerDismissGuard } from "@/ui/dialog-nested-layer";
import { markUiModalSlot, wrapModalSurfaceChildren } from "@/ui/modal-surface-children";
import "@/ui/modal-surface.css";
import "@/ui/modal-title.css";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(
  (
    { className, children, onPointerDownOutside, onInteractOutside, onFocusOutside, ...props },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "ui-modal-surface ui-modal-surface--center fixed z-50 w-full max-w-lg border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-[length:var(--control-radius)]",
          className,
        )}
        {...props}
        onPointerDownOutside={withNestedLayerDismissGuard(onPointerDownOutside)}
        onInteractOutside={withNestedLayerDismissGuard(onInteractOutside)}
        onFocusOutside={withNestedLayerDismissGuard(onFocusOutside)}
      >
        {wrapModalSurfaceChildren(children)}
        <DialogPrimitive.Close asChild>
          <DialogCloseButton />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = markUiModalSlot(
  ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("ui-modal-header", className)} {...props} />
  ),
  "header",
  "DialogHeader",
);

/**
 * Dialog action row. Convention: Cancel / dismiss = `variant="outline"`; primary
 * submit = default primary. Destructive side actions (delete / remove) =
 * icon-only `IconButton` with `variant="outline"` + `severity="danger"` (Trash2),
 * pinned start via `me-auto` — same as Calendar event/calendar dialogs.
 */
const DialogFooter = markUiModalSlot(
  ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("ui-modal-footer flex flex-row justify-end gap-2", className)} {...props} />
  ),
  "footer",
  "DialogFooter",
);

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("ui-modal-title", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
