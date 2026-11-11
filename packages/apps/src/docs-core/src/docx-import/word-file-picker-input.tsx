import type { ChangeEvent, RefObject } from "react";

/** What the file picker offers. Other files are still refused by the scan. */
const DOCX_PICKER_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The hidden picker behind Import docx file(s): one or more files. Picking the same file twice works. */
export function WordFilePickerInput({
  inputRef,
  onPick,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (files: File[]) => void;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onPick(files);
  };
  return (
    <input
      ref={inputRef}
      type="file"
      accept={DOCX_PICKER_ACCEPT}
      multiple
      hidden
      aria-hidden
      tabIndex={-1}
      data-testid="docs-import-word-file-input"
      onChange={handleChange}
    />
  );
}
