import { useEffect, useId, useRef } from "react";
import { Input } from "@/ui/input";
import { controlSizeClassName } from "@/ui/control-size";
import { cn } from "@/lib/utils";
import { NO_AUTOFILL } from "@/ui/no-autofill";

export type RenameFilenameFieldProps = {
  baseName: string;
  onBaseNameChange: (value: string) => void;
  /** When set, shown read-only at the end of the field (e.g. `.md`). */
  extension?: string;
  /** For a `<label htmlFor>` (a dialog row). */
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * When this value changes to a non-null value, focus the input and select its
   * contents (e.g. dialog open with a suggested `Untitled` name).
   */
  focusKey?: string | number | null;
  placeholder?: string;
  /** Accessible name when no label points at `id`; defaults to `placeholder`. */
  ariaLabel?: string;
  className?: string;
  onEnter?: () => void;
};

/**
 * A file's name without its extension. The extension sits inside the same field as
 * quiet text, so name and extension read as one field of the canonical size.
 */
export function RenameFilenameField({
  baseName,
  onBaseNameChange,
  extension,
  id,
  disabled = false,
  autoFocus = false,
  focusKey = null,
  placeholder,
  ariaLabel = id ? undefined : placeholder,
  className,
  onEnter,
}: RenameFilenameFieldProps) {
  const extensionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusKey == null) return;
    const frame = requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  const fieldProps = {
    id,
    autoFocus,
    ...NO_AUTOFILL,
    placeholder,
    "aria-label": ariaLabel,
    value: baseName,
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onBaseNameChange(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onEnter?.();
      }
    },
  };

  if (!extension) {
    return <Input ref={inputRef} className={className} {...fieldProps} />;
  }

  return (
    <div className={cn("input input--suffix", controlSizeClassName("input", "md"), className)}>
      <input
        ref={inputRef}
        className="input__field"
        aria-describedby={extensionId}
        {...fieldProps}
      />
      <span id={extensionId} className="input__suffix">
        {extension}
      </span>
    </div>
  );
}
