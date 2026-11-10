import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import "./checkbox.css";

/** Glyph-box sizes — not control-height tokens (`xs`…`xl` / 28–44px). */
export type CheckboxSize = "sm" | "md";

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  /** `md` = 20px default (forms); `sm` = 14px sidebar icons. */
  size?: CheckboxSize;
  /** The suite selection mark (`.checkbox--mark`): a dimmed ring, checked a solid fill. */
  mark?: boolean;
};

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, size = "md", mark = false, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn("checkbox", `checkbox--size-${size}`, mark && "checkbox--mark", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="checkbox__icon" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
