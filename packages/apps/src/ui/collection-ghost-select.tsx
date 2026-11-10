import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/ui/collection-ghost-select.css";

type GhostContentProps = {
  /** Before the label: a collection dot, a status or priority icon. */
  leading?: ReactNode;
  label: ReactNode;
  disabled?: boolean;
};

function GhostContent({ leading, label, disabled }: GhostContentProps) {
  return (
    <>
      {leading}
      <span className="collection-ghost-select__name">{label}</span>
      {disabled ? null : <ChevronDown className="collection-ghost-select__chevron" aria-hidden />}
    </>
  );
}

export type CollectionGhostSelectTriggerProps = Omit<
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
  "children"
> &
  GhostContentProps;

/**
 * The ghost dropdown trigger (suite norm): a leading mark, the current value and a
 * small chevron, no chrome. The collection switcher above a detail title (Notes,
 * Contacts, Tasks) and the Tasks detail fields. Goes inside a Radix `Select`.
 */
export const CollectionGhostSelectTrigger = forwardRef<
  HTMLButtonElement,
  CollectionGhostSelectTriggerProps
>(function CollectionGhostSelectTrigger({ leading, label, disabled, className, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn("collection-ghost-select", className)}
      disabled={disabled}
      {...props}
    >
      <GhostContent leading={leading} label={label} disabled={disabled} />
    </SelectPrimitive.Trigger>
  );
});

export type CollectionGhostButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> &
  GhostContentProps;

/** The same ghost trigger as a plain button, for a popover or dialog (a date, reminders). */
export const CollectionGhostButton = forwardRef<HTMLButtonElement, CollectionGhostButtonProps>(
  function CollectionGhostButton({ leading, label, disabled, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn("collection-ghost-select", className)}
        disabled={disabled}
        {...props}
      >
        <GhostContent leading={leading} label={label} disabled={disabled} />
      </button>
    );
  },
);
