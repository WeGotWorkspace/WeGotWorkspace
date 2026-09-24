"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/ui/sheet";

import "./side-drawer.css";

export type SideDrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: "left" | "right";
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function SideDrawer({
  open,
  onClose,
  title,
  side = "right",
  children,
  className,
  contentClassName,
}: SideDrawerProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        side={side}
        className={cn("side-drawer", className)}
        overlayClassName="side-drawer__overlay"
      >
        {title ? (
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription />
          </SheetHeader>
        ) : null}
        <div className={cn("side-drawer__body", contentClassName)}>{children}</div>
      </SheetContent>
    </Sheet>
  );
}
