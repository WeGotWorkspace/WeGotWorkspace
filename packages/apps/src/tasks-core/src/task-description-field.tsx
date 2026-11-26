import { useRef } from "react";
import { NoteTitleCaretsLayer } from "@/note-detail-view/src/note-title-carets";
import { useNoteTitleCarets } from "@/note-detail-view/src/use-note-title-carets";
import { useNoteTitleField } from "@/note-detail-view/src/use-note-title-field";
import { TEXT_FIELDS_BODY } from "@/lib/collab/docs-collab-text-fields-shape";
import type { CollabTextField } from "@/text-editor-core/docs-collab/docs-collab-title-selection";
import { hasLinks } from "@/lib/linkify/linkify-text";
import { LinkifiedText } from "@/lib/linkify/linkified-text";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import { TASK_DESCRIPTION_MAX_LENGTH } from "@/tasks-core/src/task-text-session";

/** The description's `Y.Text` and the awareness field its carets travel in. */
export const TASK_DESCRIPTION_FIELD: CollabTextField = {
  key: TEXT_FIELDS_BODY,
  selectionField: "plainBodySelection",
};

/**
 * The task's notes. In a live room they bind to `plain-body` with the other
 * people's carets; without one they are the form's controlled field, saved by
 * the autosave.
 */
export function TaskDescriptionField({
  value,
  placeholder,
  label,
  readOnly,
  onChange,
  onBlur,
}: {
  value: string;
  placeholder: string;
  label: string;
  readOnly: boolean;
  /** The autosave path, used only outside a room. */
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const field = useNoteTitleField({
    title: value,
    readOnly,
    onTitleEdit: onChange,
    ytextKey: TEXT_FIELDS_BODY,
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  const editable = field.onChange != null;
  const carets = useNoteTitleCarets(ref, { publish: editable, field: TASK_DESCRIPTION_FIELD });
  return (
    <div className="tasks-detail-view__notes-field note-detail-view__title-field">
      {!editable && hasLinks(field.value) ? (
        <LinkifiedText
          className="tasks-detail-view__notes note-detail-view__notes note-detail-view__body-start"
          text={field.value}
        />
      ) : (
        <TextareaAutosize
          ref={ref}
          className="tasks-detail-view__notes note-detail-view__notes note-detail-view__body-start"
          value={field.value}
          onChange={editable ? (event) => field.onChange?.(event.target.value) : undefined}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-label={label}
          readOnly={!editable}
          maxLength={TASK_DESCRIPTION_MAX_LENGTH}
          minRows={2}
          // Grows with the notes, however long: the pane scrolls, not the field.
          maxRows={Number.POSITIVE_INFINITY}
        />
      )}
      <NoteTitleCaretsLayer textareaRef={ref} carets={carets} value={field.value} />
    </div>
  );
}
