import { useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { FieldLabelRow } from "@/ui/field-label-row";

export type InstallerDefaultFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "className"
> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Plain note under the field, read with it. */
  hint?: ReactNode;
  /** Highlighted note under the field; marks the field invalid when `invalid` is set. */
  warning?: ReactNode;
  invalid?: boolean;
  /** Announce the warning as it appears, for a server reply rather than a standing note. */
  announceWarning?: boolean;
};

/**
 * A field that starts on the value the installer picked. Keep it, copy it,
 * or type over it.
 */
export function InstallerDefaultField({
  label,
  value,
  onValueChange,
  hint,
  warning,
  invalid = false,
  announceWarning = false,
  id,
  ...inputProps
}: InstallerDefaultFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const noteId = useId();
  const note = warning ?? hint;

  return (
    <div className="installer__field">
      <FieldLabelRow htmlFor={fieldId} label={label}>
        <div className="input input--size-md installer__default-field">
          <input
            {...inputProps}
            id={fieldId}
            className="input__field"
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={invalid || undefined}
            aria-describedby={note ? noteId : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
          />
        </div>
      </FieldLabelRow>
      {warning ? (
        <p
          className="installer__default-field-warning"
          id={noteId}
          role={announceWarning ? "alert" : undefined}
        >
          <TriangleAlert className="installer__default-field-warning-icon" aria-hidden />
          <span>{warning}</span>
        </p>
      ) : hint ? (
        <p className="installer__hint" id={noteId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
