"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { DialogCloseButton } from "@/ui/dialog-close-button";
import { withNestedLayerDismissGuard } from "@/ui/dialog-nested-layer";
import { useInertOutsideLayerRef } from "@/ui/inert-outside-layer";
import { markUiModalSlot, wrapModalSurfaceChildren } from "@/ui/modal-surface-children";
import "@/ui/modal-surface.css";
import "@/ui/modal-title.css";
import "@/ui/overlay-paper.css";

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

/** Radix content whose outside is inert while open, not only aria-hidden. */
const DialogContentLayer = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>((props, ref) => <DialogPrimitive.Content ref={useInertOutsideLayerRef(ref)} {...props} />);
DialogContentLayer.displayName = "DialogContentLayer";

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
      <DialogContentLayer
        ref={ref}
        className={cn(
          "overlay-paper ui-modal-surface ui-modal-surface--center fixed z-50 w-full border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
      </DialogContentLayer>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Pinned to the end of the title row: a status, such as the autosave tag. */
  end?: React.ReactNode;
};

const DialogHeader = markUiModalSlot(
  ({ className, end, children, ...props }: DialogHeaderProps) =>
    end == null ? (
      <div className={cn("ui-modal-header", className)} {...props}>
        {children}
      </div>
    ) : (
      <div className={cn("ui-modal-header ui-modal-header--split", className)} {...props}>
        <div className="ui-modal-header__text">{children}</div>
        <div className="ui-modal-header__end">{end}</div>
      </div>
    ),
  "header",
  "DialogHeader",
);

type DialogFooterProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * Pinned to the start of the row: a destructive side action (icon-only `IconButton`,
   * `variant="outline"` + `severity="danger"`, Trash2) or a quiet ghost link ("Open in
   * Settings"). The children stay at the end.
   */
  start?: React.ReactNode;
};

/**
 * Dialog action row (suite norm). A dialog that creates or edits a record ends in
 * Cancel (`variant="outline"`) and Save (primary). A dialog of preferences saves as the
 * user goes and ends in one primary Done.
 */
const DialogFooter = markUiModalSlot(
  ({ className, start, children, ...props }: DialogFooterProps) =>
    start ? (
      <div className={cn("ui-modal-footer ui-modal-footer--split", className)} {...props}>
        <div className="ui-modal-footer__start">{start}</div>
        <div className="ui-modal-footer__end">{children}</div>
      </div>
    ) : (
      <div
        className={cn("ui-modal-footer flex flex-row flex-wrap justify-end gap-2", className)}
        {...props}
      >
        {children}
      </div>
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
