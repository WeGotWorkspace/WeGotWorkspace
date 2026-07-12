"use client";

import { forwardRef } from "react";
import { X } from "lucide-react";
import { IconButton, type IconButtonProps } from "@/button/src/icon-button";
import { cn } from "@/lib/utils";
import "@/ui/dialog-close-button.css";

export type DialogCloseButtonProps = Omit<IconButtonProps, "label" | "icon" | "showTooltip"> & {
  label?: string;
};

export const DialogCloseButton = forwardRef<HTMLButtonElement, DialogCloseButtonProps>(
  function DialogCloseButton(
    { label = "Close", className, size = "sm", variant = "subtle", ...props },
    ref,
  ) {
    return (
      <IconButton
        ref={ref}
        label={label}
        icon={<X className="size-4" aria-hidden />}
        size={size}
        variant={variant}
        showTooltip={false}
        className={cn("dialog-close-button", className)}
        {...props}
      />
    );
  },
);
