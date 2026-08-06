import { TagGroup } from "@/tag/src/tag";
import { cn } from "@/lib/utils";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";
import {
  NoteCollabEditorSurface,
  NoteTextEditorBody,
  type NoteCollabConfig,
} from "@/note-detail-view/src/note-text-editor-body";

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
  pullQuote?: string;
  /** Body paragraphs; seeded into the collab document via {@link noteBodyToMarkdown}. */
  body: string[];
  /**
   * Collab config for the body. When provided (and not read-only), the body is
   * edited via the Docs Yjs stack and persists through the collab document — the
   * body never flows through the Notes metadata API. Omit for read-only/solo.
   *
   * Requires a parent {@link NoteCollabSession} (typically via WorkspaceApp
   * `detailWrapper`) so action-bar presence and the editor share one session.
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
  pullQuote,
  body,
  collab,
  readOnly = false,
  className,
}: NoteDetailViewProps) {
  const markdown = noteBodyToMarkdown(body);
  const useCollabSurface = !readOnly && collab != null;

  return (
    <article className={cn("note-detail-view max-w-[680px] mx-auto", className)}>
      <TagGroup
        className="note-detail-view__tag-group py-6 mb-6"
        size="lg"
        tags={tags}
        readonly={readOnly}
        suggestions={availableTags}
        onAddTag={readOnly ? undefined : onTagAdd}
        onRemoveTag={readOnly ? undefined : onTagRemove}
      />

      {pullQuote ? (
        <p className="note-detail-view__pull-quote text-xl leading-snug mb-8 font-medium">
          “{pullQuote}”
        </p>
      ) : null}

      {useCollabSurface ? (
        <NoteCollabEditorSurface />
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
