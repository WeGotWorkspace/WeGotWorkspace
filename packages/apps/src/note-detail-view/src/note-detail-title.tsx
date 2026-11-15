import { useId, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import { NoteDetailEyebrow } from "@/note-detail-view/src/note-detail-eyebrow";
import "@/note-detail-view/src/note-detail-view.css";

/** Enter in the title moves on to `note-detail-view__body-start` (a title has one paragraph). */
function focusBodyFromTitle(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  const root = event.currentTarget.closest(".note-detail-view, form");
  root
    ?.querySelector<HTMLElement>(
      ".note-text-editor-body [contenteditable='true'], .note-detail-view__body-start",
    )
    ?.focus();
}

export type NoteDetailTitleProps = {
  value: string;
  placeholder: string;
  /** The field's accessible name. Defaults to the placeholder. */
  label?: string;
  onChange?: (value: string) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Above the title: the collection it is in (notebook, task list, calendar). */
  eyebrow?: ReactNode;
  /** Left of the title, on its first line (a task's done box). */
  leading?: ReactNode;
  /** Over the field, e.g. collaborators' carets. */
  overlay?: ReactNode;
};

/**
 * The top of a detail (Notes, Tasks, Calendar): the collection dropdown, then the title
 * as a large borderless field. Enter moves on to the body.
 */
export function NoteDetailTitle({
  value,
  placeholder,
  label = placeholder,
  onChange,
  onBlur,
  readOnly = false,
  autoFocus = false,
  textareaRef,
  eyebrow,
  leading,
  overlay,
}: NoteDetailTitleProps) {
  const id = useId();
  const editable = !readOnly && onChange != null;
  const field = (
    <div className="note-detail-view__title-field">
      <TextareaAutosize
        ref={textareaRef}
        id={id}
        className="note-detail-view__title"
        value={value}
        placeholder={placeholder}
        readOnly={!editable}
        autoFocus={autoFocus && editable}
        minRows={1}
        maxRows={12}
        wrap="soft"
        onChange={editable ? (event) => onChange(event.target.value) : undefined}
        onKeyDown={editable ? focusBodyFromTitle : undefined}
        onBlur={editable ? onBlur : undefined}
      />
      {overlay}
    </div>
  );
  return (
    <>
      <NoteDetailEyebrow>{eyebrow}</NoteDetailEyebrow>
      <label className="note-detail-view__title-label" htmlFor={id}>
        {label}
      </label>
      {leading ? (
        <div className="note-detail-view__title-row">
          <div className="note-detail-view__title-leading">{leading}</div>
          {field}
        </div>
      ) : (
        field
      )}
    </>
  );
}
