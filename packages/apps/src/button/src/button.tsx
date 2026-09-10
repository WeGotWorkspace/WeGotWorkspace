import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/button/src/button.css";
import {
  BUTTON_BASE_CLASSNAME,
  BUTTON_ICON_SLOT_CLASSNAME,
  BUTTON_PILL_CLASSNAME,
  BUTTON_VARIANT_CLASSNAMES,
  getButtonSizeClassName,
  normalizeButtonVariant,
  type ButtonSizeProp,
  type ButtonVariantProp,
} from "@/button/src/button.shared";
export {
  BUTTON_SIZE_OPTIONS,
  BUTTON_VARIANT_OPTIONS,
  ICON_BUTTON_SIZE_OPTIONS,
  buttonVariants,
  normalizeButtonSize,
  normalizeButtonVariant,
  type ButtonSize,
  type ButtonSizeProp,
  type ButtonVariant,
  type ButtonVariantProp,
  type IconButtonSize,
  type ShadcnButtonSize,
  type ShadcnButtonVariant,
} from "@/button/src/button.shared";
export { IconButton } from "@/button/src/icon-button";
export type { IconButtonProps } from "@/button/src/icon-button";

export type ButtonProps = Omit<React.ComponentPropsWithRef<"button">, "children"> & {
  label?: string;
  icon?: ReactNode;
  size?: ButtonSizeProp;
  pill?: boolean;
  variant?: ButtonVariantProp;
  asChild?: boolean;
  children?: ReactNode;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      label,
      icon,
      size = "md",
      pill = false,
      variant = "primary",
      className,
      style,
      children,
      asChild = false,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const normalizedVariant = normalizeButtonVariant(variant);
    const content = asChild
      ? children
      : (children ?? (
          <>
            {icon ? <span className={BUTTON_ICON_SLOT_CLASSNAME}>{icon}</span> : null}
            {label ? <span className="button__label">{label}</span> : null}
          </>
        ));

    return (
      <Comp
        type={asChild ? undefined : type}
        aria-label={props["aria-label"] ?? (asChild ? undefined : label)}
        className={cn(
          BUTTON_BASE_CLASSNAME,
          getButtonSizeClassName(size),
          pill && BUTTON_PILL_CLASSNAME,
          BUTTON_VARIANT_CLASSNAMES[normalizedVariant],
          className,
        )}
        style={style}
        {...props}
        ref={ref}
      >
        {content}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button };
