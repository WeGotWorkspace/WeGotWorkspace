import { useEffect, useRef } from "react";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";

import "@/dialogs/src/rename-filename-field.css";

export type RenameFilenameFieldProps = {
  baseName: string;
  onBaseNameChange: (value: string) => void;
  /** When set, shown read-only after the input (e.g. `.md`). */
  extension?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * When this value changes to a non-null value, focus the input and select its
   * contents (e.g. dialog open with a suggested `Untitled` name).
   */
  focusKey?: string | number | null;
  placeholder?: string;
  className?: string;
  onEnter?: () => void;
};

export function RenameFilenameField({
  baseName,
  onBaseNameChange,
  extension,
  disabled = false,
  autoFocus = false,
  focusKey = null,
  placeholder,
  className,
  onEnter,
}: RenameFilenameFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showExtension = Boolean(extension);

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

  if (!showExtension) {
    return (
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        className={className}
        size="sm"
        placeholder={placeholder}
        value={baseName}
        disabled={disabled}
        onChange={(event) => onBaseNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter?.();
          }
        }}
      />
    );
  }

  return (
    <div className={cn("rename-filename-field", className)}>
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        className="rename-filename-field__input"
        size="sm"
        placeholder={placeholder}
        value={baseName}
        disabled={disabled}
        aria-describedby="rename-filename-extension"
        onChange={(event) => onBaseNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEnter?.();
          }
        }}
      />
      <span id="rename-filename-extension" className="rename-filename-field__extension" aria-hidden>
        {extension}
      </span>
    </div>
  );
}
