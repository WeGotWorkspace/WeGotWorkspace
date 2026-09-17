import * as React from "react";

import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";

import "./input.css";

export type TextareaProps = React.ComponentProps<"textarea"> & {
  /** Padding + font-size only; height stays auto. Default `md`. */
  size?: ControlSize;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size = "md", ...props }, ref) => {
    return (
      <textarea
        className={cn("textarea", controlSizeClassName("textarea", size), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
