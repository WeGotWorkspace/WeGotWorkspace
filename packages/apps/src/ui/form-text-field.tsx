import { useId, type ReactNode } from "react";
import type { FieldPath, FieldValues } from "react-hook-form";
import { useFormContext } from "react-hook-form";

import { cn } from "@/lib/utils";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/ui/form";

import "@/ui/field-label-row.css";

export type FormTextFieldProps<TFieldValues extends FieldValues> = {
  name: FieldPath<TFieldValues>;
  label: string;
  /**
   * `stacked` (default): caption above the input.
   * `inline`: the suite settings row (`FieldLabelRow` inline): caption and description
   * start, the input fills the end column.
   */
  layout?: "stacked" | "inline";
  /** Quiet line under the caption (`inline` layout). */
  description?: ReactNode;
  /** Merged onto `FormItem` (stacked) or the row (inline). */
  itemClassName?: string;
  /** Merged onto the label. */
  labelClassName?: string;
} & Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  "defaultChecked" | "defaultValue" | "name" | "onBlur" | "onChange" | "ref" | "value"
>;

/**
 * Opinionated text `Input` bound to react-hook-form (`FormField` + `Controller` from `@/ui/form`).
 * Must be rendered under `<Form>` (same as {@link useFormContext}).
 */
export function FormTextField<TFieldValues extends FieldValues>({
  name,
  label,
  layout = "stacked",
  description,
  itemClassName,
  labelClassName,
  ...inputProps
}: FormTextFieldProps<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>();
  const inputId = useId();
  const messageId = `${inputId}-message`;

  if (layout === "inline") {
    // No `FormItem` wrapper: inline rows sit side by side so the suite hairline runs between them.
    return (
      <FormField
        control={control}
        name={name}
        render={({ field, fieldState }) => (
          <FieldLabelRow
            layout="inline"
            fill
            label={label}
            description={description}
            htmlFor={inputId}
            className={itemClassName}
            labelClassName={cn(fieldState.error && "text-destructive", labelClassName)}
          >
            <Input
              {...inputProps}
              {...field}
              id={inputId}
              aria-invalid={Boolean(fieldState.error)}
              aria-describedby={fieldState.error ? messageId : undefined}
            />
            {fieldState.error?.message ? (
              <p id={messageId} className="text-[0.8rem] font-medium text-destructive">
                {fieldState.error.message}
              </p>
            ) : null}
          </FieldLabelRow>
        )}
      />
    );
  }

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={itemClassName}>
          <FormLabel className={cn("field-label-row__label", labelClassName)}>{label}</FormLabel>
          <FormControl>
            <Input {...inputProps} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
