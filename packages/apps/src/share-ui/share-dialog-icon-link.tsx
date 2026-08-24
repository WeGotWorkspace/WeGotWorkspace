import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";
import "@/button/src/button.css";
import "@/button/src/icon-button.css";
import {
  BUTTON_BASE_CLASSNAME,
  BUTTON_ICON_SLOT_CLASSNAME,
  BUTTON_VARIANT_CLASSNAMES,
  ICON_BUTTON_SIZE_CLASSNAMES,
} from "@/button/src/button.shared";

export type ShareDialogIconLinkProps = Omit<ComponentProps<"a">, "children"> & {
  label: string;
  icon: ReactNode;
};

/** IconButton look on an `<a>` — same sm/outline chrome as Drive share-row actions. */
export function ShareDialogIconLink({
  label,
  icon,
  className,
  ...props
}: ShareDialogIconLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          aria-label={label}
          className={cn(
            BUTTON_BASE_CLASSNAME,
            ICON_BUTTON_SIZE_CLASSNAMES.sm,
            BUTTON_VARIANT_CLASSNAMES.outline,
            "share-dialog__icon-link",
            className,
          )}
          {...props}
        >
          <span className={BUTTON_ICON_SLOT_CLASSNAME}>{icon}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
