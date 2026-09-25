import { cn } from "@/lib/utils";
import { CONTROL_SIZE_OPTIONS, controlSizeClassName, type ControlSize } from "@/ui/control-size";

export const BUTTON_SIZE_OPTIONS = CONTROL_SIZE_OPTIONS;
export const ICON_BUTTON_SIZE_OPTIONS = CONTROL_SIZE_OPTIONS;
export const BUTTON_VARIANT_OPTIONS = [
  "primary",
  "destructive",
  "destructive-outline",
  "outline",
  "ghost",
  "link",
] as const;

export type ButtonVariant = (typeof BUTTON_VARIANT_OPTIONS)[number];
export type ButtonSize = ControlSize;
export type IconButtonSize = ControlSize;

/** Semantic severity for outline/ghost actions (fg + wash). */
export type ButtonSeverity = "danger" | "success";

/** shadcn / Radix UI kit variant names — mapped to product variants in {@link normalizeButtonVariant}. */
export type ShadcnButtonVariant =
  "default" | "outline" | "secondary" | "destructive" | "ghost" | "link";

/** shadcn / Radix UI kit size names — mapped to product sizes in {@link normalizeButtonSize}. */
export type ShadcnButtonSize = "default" | "sm" | "lg" | "icon";

export type ButtonVariantProp = ButtonVariant | ShadcnButtonVariant;
export type ButtonSizeProp = ButtonSize | ShadcnButtonSize;

export const BUTTON_BASE_CLASSNAME = "button";
export const BUTTON_PILL_CLASSNAME = "button--pill";
export const BUTTON_ICON_SLOT_CLASSNAME = "button__icon";
export const BUTTON_SIZE_ICON_CLASSNAME = "button--size-icon";
export const ICON_BUTTON_ACTIVE_CLASSNAME = "icon-button--active";

export const BUTTON_SIZE_CLASSNAMES: Record<ButtonSize, string> = {
  xs: controlSizeClassName("button", "xs"),
  sm: controlSizeClassName("button", "sm"),
  md: controlSizeClassName("button", "md"),
  lg: controlSizeClassName("button", "lg"),
  xl: controlSizeClassName("button", "xl"),
};
export const ICON_BUTTON_SIZE_CLASSNAMES: Record<IconButtonSize, string> = {
  xs: controlSizeClassName("icon-button", "xs"),
  sm: controlSizeClassName("icon-button", "sm"),
  md: controlSizeClassName("icon-button", "md"),
  lg: controlSizeClassName("icon-button", "lg"),
  xl: controlSizeClassName("icon-button", "xl"),
};
export const BUTTON_VARIANT_CLASSNAMES: Record<ButtonVariant, string> = {
  primary: "button--variant-primary",
  destructive: "button--variant-destructive",
  "destructive-outline": "button--variant-destructive-outline",
  outline: "button--variant-outline",
  ghost: "button--variant-ghost",
  link: "button--variant-link",
};

export const BUTTON_SEVERITY_CLASSNAMES: Record<ButtonSeverity, string> = {
  danger: "button--severity-danger",
  success: "button--severity-success",
};

export function normalizeButtonVariant(
  variant: ButtonVariantProp | null | undefined,
): ButtonVariant {
  switch (variant) {
    case undefined:
    case null:
    case "default":
    case "primary":
      return "primary";
    case "secondary":
      return "outline";
    default:
      return variant;
  }
}

export function normalizeButtonSize(size: ButtonSizeProp | null | undefined): ButtonSize | "icon" {
  switch (size) {
    case undefined:
    case null:
    case "default":
    case "md":
      return "md";
    case "icon":
      return "icon";
    default:
      return size;
  }
}

export function getButtonSizeClassName(size: ButtonSizeProp | null | undefined): string {
  const normalizedSize = normalizeButtonSize(size);
  return normalizedSize === "icon"
    ? BUTTON_SIZE_ICON_CLASSNAME
    : BUTTON_SIZE_CLASSNAMES[normalizedSize];
}

export type ButtonVariantsOptions = {
  variant?: ButtonVariantProp | null;
  size?: ButtonSizeProp | null;
  className?: string;
};

/** Class-name helper for Radix/shadcn surfaces that style non-{@link Button} elements as buttons. */
export function buttonVariants({ variant, size, className }: ButtonVariantsOptions = {}): string {
  const normalizedVariant = normalizeButtonVariant(variant);
  return cn(
    BUTTON_BASE_CLASSNAME,
    getButtonSizeClassName(size),
    BUTTON_VARIANT_CLASSNAMES[normalizedVariant],
    className,
  );
}

export type { ControlSize };
