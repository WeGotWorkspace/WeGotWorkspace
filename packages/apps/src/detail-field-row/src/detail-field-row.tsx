import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { CardRow } from "@/card/src/card-row";
import { cn } from "@/lib/utils";
import "@/detail-field-row/src/detail-field-row.css";

export type DetailFieldRowProps = {
  /** Small icon before the label (a Lucide mark). */
  icon?: ReactNode;
  /** The label column as plain text. */
  title?: string;
  /** The label column as a control instead, e.g. a phone's type dropdown. */
  label?: ReactNode;
  /** The value: a ghost dropdown, a ghost field, a switch. */
  children?: ReactNode;
  /** After the value, e.g. a remove button. Shows on hover and focus on a mouse. */
  trailing?: ReactNode;
  /** Centre the row on the value (a switch) instead of on the text baseline. */
  center?: boolean;
  /** The value on its own line under the label, full width (long text, e.g. notes). */
  stacked?: boolean;
  className?: string;
};

/**
 * One field of an open item on the detail sheet (suite norm, Tasks and Contacts):
 * an icon, a fixed label column so every value starts on one line, then the value.
 * Rows sit in a {@link DetailFieldList}, split by the suite hairline.
 */
export function DetailFieldRow({
  icon,
  title,
  label,
  children,
  trailing,
  center = false,
  stacked = false,
  className,
}: DetailFieldRowProps) {
  return (
    <CardRow
      className={cn(
        "detail-field-row",
        center && "detail-field-row--center",
        stacked && "detail-field-row--stacked",
        className,
      )}
      leading={<span className="detail-field-row__icon">{icon}</span>}
      title={title}
      titleExtra={label}
    >
      {children}
      {trailing ? <span className="detail-field-row__trailing">{trailing}</span> : null}
    </CardRow>
  );
}

/** The rows of a detail sheet, with the hairline above the first one. */
export function DetailFieldList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("detail-field-list", className)}>{children}</div>;
}

/**
 * The quiet "Add …" button: the plus in the icon column, the label in the label
 * column. Forwards its ref, so it can be a menu trigger ("Add field").
 */
export const DetailFieldAddButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & { label: string }
>(function DetailFieldAddButton({ label, className, ...props }, ref) {
  return (
    <button ref={ref} type="button" className={cn("detail-field-row__add", className)} {...props}>
      <span className="detail-field-row__icon">
        <Plus aria-hidden />
      </span>
      <span className="detail-field-row__add-label">{label}</span>
    </button>
  );
});

/**
 * The last row of a repeatable field (phones, e-mails): adds one more. Pass
 * `children` instead of `onAdd` to put a menu around the button.
 */
export function DetailFieldAddRow({
  label,
  onAdd,
  children,
  className,
}: {
  label?: string;
  onAdd?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("detail-field-row detail-field-row--add card__row", className)}>
      {children ?? <DetailFieldAddButton label={label ?? ""} onClick={onAdd} />}
    </div>
  );
}
