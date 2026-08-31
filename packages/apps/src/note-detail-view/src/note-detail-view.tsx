import { useId, type KeyboardEvent } from "react";
import { TagGroup } from "@/tag/src/tag";
import { cn } from "@/lib/utils";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import {
  NoteCollabEditorSurface,
  NoteTextEditorBody,
  type NoteCollabConfig,
} from "@/note-detail-view/src/note-text-editor-body";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import "@/note-detail-view/src/note-detail-view.css";

function focusNoteBodyFromTitle(titleEl: HTMLTextAreaElement): void {
  const root = titleEl.closest(".note-detail-view");
  const body = root?.querySelector<HTMLElement>(".note-text-editor-body [contenteditable='true']");
  body?.focus();
}

function handleTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  focusNoteBodyFromTitle(event.currentTarget);
}

export type NoteDetailViewProps = {
  /** Used for React keys on editors when switching notes. */
  noteId: string;
  /**
   * Revision token for the solo editor remount key (e.g. last-edited stamp).
   * Not displayed — notebook / edited meta live in the pinned detail footer.
   */
  contentRevision?: string;
  tags: string[];
  /** Existing note tags offered as autocomplete when adding. */
  availableTags?: string[];
  /** Confirm a tag from the inline add field (existing or newly typed). */
  onTagAdd?: (label: string) => void;
  onTagRemove?: (label: string) => void;
  /**
   * When `false`, omit the tag group entirely (personal share recipients).
   * Default `true`.
   */
  showTags?: boolean;
  /** VJOURNAL SUMMARY. Required in the product; empty until autofill or the user types. */
  title?: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  pullQuote?: string;
  /** Body paragraphs; seeded into the collab document via {@link noteBodyToMarkdown}. */
  body: string[];
  /**
   * Collab config for the body. When provided, the body uses the Docs Yjs stack
   * (parent {@link NoteCollabSession}). View-only shares keep the surface with
   * TipTap `editable={false}`. Omit for Storybook / solo editors.
   */
  collab?: NoteCollabConfig;
  /** When `true`, body and tags are display-only. Default `false` (editing on). */
  readOnly?: boolean;
  className?: string;
};

export function NoteDetailView({
  noteId,
  contentRevision = "",
  tags,
  availableTags,
  onTagAdd,
  onTagRemove,
  showTags = true,
  title = "",
  onTitleChange,
  titlePlaceholder = "Title",
  pullQuote,
  body,
  collab,
  readOnly = false,
  className,
}: NoteDetailViewProps) {
  const markdown = noteBodyToMarkdown(body);
  // Keep the shared Yjs surface for view-only (presence + live body); TipTap
  // `editable` enforces read-only. Solo editor is for Storybook / no collab.
  const useCollabSurface = collab != null;
  const tagsReadOnly = readOnly || onTagAdd == null;

  const titleReadOnly = readOnly || onTitleChange == null;
  const titleFieldId = useId();

  return (
    <article className={cn("note-detail-view note-detail-sheet", className)}>
      <label className="note-detail-view__title-label" htmlFor={titleFieldId}>
        {titlePlaceholder}
      </label>
      <TextareaAutosize
        id={titleFieldId}
        className="note-detail-view__title"
        value={title}
        placeholder={titlePlaceholder}
        readOnly={titleReadOnly}
        minRows={1}
        maxRows={12}
        wrap="soft"
        onChange={titleReadOnly ? undefined : (event) => onTitleChange(event.target.value)}
        onKeyDown={titleReadOnly ? undefined : handleTitleKeyDown}
      />
      {showTags ? (
        <TagGroup
          className="note-detail-view__tag-group"
          size="lg"
          tags={tags}
          readonly={tagsReadOnly}
          suggestions={availableTags}
          onAddTag={tagsReadOnly ? undefined : onTagAdd}
          onRemoveTag={tagsReadOnly ? undefined : onTagRemove}
        />
      ) : null}

      {pullQuote ? (
        <p className="note-detail-view__pull-quote text-xl leading-snug mb-8 font-medium">
          “{pullQuote}”
        </p>
      ) : null}

      {useCollabSurface ? (
        <NoteCollabEditorSurface editable={!readOnly} />
      ) : (
        <NoteTextEditorBody
          noteId={noteId}
          contentRevision={contentRevision}
          initialMarkdown={markdown}
          readOnly={readOnly}
        />
      )}
    </article>
  );
}
