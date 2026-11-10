import type { ChangeEvent, RefObject } from "react";

/** What the file picker offers. Other files are still refused by the scan. */
const DOCX_PICKER_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The hidden picker behind Import Word file. Picking the same file twice works. */
export function WordFilePickerInput({
  inputRef,
  onPick,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onPick(file);
  };
  return (
    <input
      ref={inputRef}
      type="file"
      accept={DOCX_PICKER_ACCEPT}
      hidden
      aria-hidden
      tabIndex={-1}
      data-testid="docs-import-word-file-input"
      onChange={handleChange}
    />
  );
}
