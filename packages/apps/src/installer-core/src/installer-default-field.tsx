import { useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { FieldLabelRow } from "@/ui/field-label-row";

export type InstallerDefaultFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "placeholder" | "className"
> & {
  label: string;
  /** What the installer uses while the field is empty; shown as the placeholder. */
  defaultValue: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Shown under the field; marks the field invalid when `invalid` is set. */
  warning?: ReactNode;
  invalid?: boolean;
};

/**
 * One field whose placeholder is the value the installer picked. Leave it
 * empty to keep that value, or type to replace it.
 */
export function InstallerDefaultField({
  label,
  defaultValue,
  value,
  onValueChange,
  warning,
  invalid = false,
  id,
  ...inputProps
}: InstallerDefaultFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const warningId = useId();

  return (
    <div className="installer__field">
      <FieldLabelRow htmlFor={fieldId} label={label}>
        <div className="input input--size-md installer__default-field">
          <input
            {...inputProps}
            id={fieldId}
            className="input__field"
            value={value}
            placeholder={defaultValue}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={warning ? warningId : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
          />
        </div>
      </FieldLabelRow>
      {warning ? (
        <p className="installer__default-field-warning" id={warningId} role="alert">
          <TriangleAlert className="installer__default-field-warning-icon" aria-hidden />
          <span>{warning}</span>
        </p>
      ) : null}
    </div>
  );
}
