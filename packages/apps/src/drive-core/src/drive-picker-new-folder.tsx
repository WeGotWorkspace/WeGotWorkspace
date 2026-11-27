import { useEffect, useRef, type KeyboardEvent } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import type { DrivePickerNewFolderControl } from "@/drive-core/src/drive-picker-new-folder-utils";
import type { DriveUILabels } from "@/drive-core/src/drive-labels";

/**
 * The folder being named, as a row above the listing. It is the real folder as soon
 * as Enter is pressed; Escape drops it.
 */
export function DrivePickerNewFolderRow({
  labels,
  value,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  labels: Pick<DriveUILabels, "pickerNewFolderNameLabel">;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Ready to type: the suggested name is selected, so typing replaces it.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys here are the field's own: not the list's, and Escape must not close the dialog.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="destination-picker__new-folder">
      <FolderPlus className="destination-picker__new-folder-icon size-4" aria-hidden />
      <div className="destination-picker__new-folder-field">
        <Input
          ref={inputRef}
          size="sm"
          value={value}
          aria-label={labels.pickerNewFolderNameLabel}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {error ? (
          <p className="destination-picker__new-folder-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** *New folder* for a dialog footer, left of Cancel; reads the picker's control. */
export function DrivePickerNewFolderButton({
  labels,
  control,
}: {
  labels: Pick<DriveUILabels, "pickerNewFolder">;
  control: DrivePickerNewFolderControl | null;
}) {
  if (!control) return null;
  const reason = control.disabledReason;
  return (
    // A disabled button gets no hover events, so the reason rides on a wrapper.
    <span title={reason ?? undefined}>
      <Button
        variant="outline"
        disabled={reason !== null || control.active}
        aria-description={reason ?? undefined}
        onClick={control.start}
      >
        <FolderPlus className="size-4" aria-hidden />
        {labels.pickerNewFolder}
      </Button>
    </span>
  );
}
