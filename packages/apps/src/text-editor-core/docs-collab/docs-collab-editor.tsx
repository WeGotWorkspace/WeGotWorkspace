import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { cn } from "@/lib/utils";
import { type TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import {
  TextEditorFormatBar,
  type TextEditorFormatBarConfig,
  resolveTextEditorFormatBarConfig,
} from "@/text-editor-core/src/text-editor-format-bar";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { getCommentMarkIdFromTarget } from "@/text-editor-core/src/text-editor-comment-commands";
import { getTrackChangeIdFromTarget } from "@/text-editor-core/src/text-editor-track-changes";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { TextEditorSource } from "@/text-editor-core/src/text-editor-source";
import { useTextEditorSourceSync } from "@/text-editor-core/src/use-text-editor-source-sync";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { DocsCollabCommentControl } from "./docs-collab-comment-control";
import { DocsCollabSuggestControls } from "./docs-collab-suggest-controls";

import "@/text-editor-core/src/text-editor.css";

export type DocsCollabEditorProps = {
  ydoc: Y.Doc;
  awareness: Awareness;
  user: { name: string; color: string; id?: string };
  format?: TextEditorContentFormat;
  formatBar?: boolean | TextEditorFormatBarConfig;
  sheetFill?: boolean;
  viewSource?: boolean;
  /** When false, the TipTap surface rejects typing (view / comment-only). */
  editable?: boolean;
  /**
   * TipTap mount focus. Default focuses the end of an editable doc (existing
   * notes). Pass `false` when another field (e.g. a new-note title) should keep focus.
   */
  autofocus?: UseEditorOptions["autofocus"];
  /**
   * When true, formatting controls on the bar are disabled (comment-only share).
   * Comment control remains independently gated via `commentsDisabled`.
   */
  formattingDisabled?: boolean;
  className?: string;
  /** @deprecated Prefer `onContentChange`; kept for compatibility paths. */
  onMarkdownChange?: (getMarkdown: () => string) => void;
  onContentChange?: (getContent: () => string) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onCommentActivated?: (commentId: string, clickPos: number) => void;
  onSuggestionActivated?: (changeId: string) => void;
  onAddCommentFromSelection?: () => void;
  canAddCommentFromSelection?: boolean;
  commentsDisabled?: boolean;
  commentsDisabledTitle?: string;
  commentControlLabels?: Pick<
    DocsUILabels,
    | "commentsAddFromSelection"
    | "commentsAddFromSelectionDisabledNoSelection"
    | "commentsAddFromSelectionDisabledViewSource"
    | "commentsAddFromSelectionDisabledReadOnly"
  >;
  /** When false, hide Edit/Suggest mode control. */
  showSuggestControls?: boolean;
  commentsOverlay?: ReactNode;
  suggestionsOverlay?: ReactNode;
};

export function DocsCollabEditor({
  ydoc,
  awareness,
  user,
  format = "markdown",
  formatBar = true,
  sheetFill = false,
  viewSource = false,
  editable = true,
  autofocus,
  formattingDisabled = false,
  className,
  onMarkdownChange,
  onContentChange,
  onEditorReady,
  onCommentActivated,
  onSuggestionActivated,
  onAddCommentFromSelection,
  canAddCommentFromSelection = false,
  commentsDisabled = false,
  commentsDisabledTitle,
  commentControlLabels,
  showSuggestControls = true,
  commentsOverlay,
  suggestionsOverlay,
}: DocsCollabEditorProps) {
  const effectiveOnContentChange = onContentChange ?? onMarkdownChange;
  const onContentChangeRef = useRef(effectiveOnContentChange);
  onContentChangeRef.current = effectiveOnContentChange;
  const onCommentActivatedRef = useRef(onCommentActivated);
  onCommentActivatedRef.current = onCommentActivated;
  const onSuggestionActivatedRef = useRef(onSuggestionActivated);
  onSuggestionActivatedRef.current = onSuggestionActivated;

  const editorProps = useMemo(
    () => ({
      attributes: { class: "text-editor-prose focus:outline-none" },
      handleClick: (_view: unknown, pos: number, event: MouseEvent) => {
        const commentId = getCommentMarkIdFromTarget(event.target);
        if (commentId) {
          onCommentActivatedRef.current?.(commentId, pos);
          return true;
        }
        const changeId = getTrackChangeIdFromTarget(event.target);
        if (changeId) {
          onSuggestionActivatedRef.current?.(changeId);
          return true;
        }
        return false;
      },
    }),
    [],
  );

  const editor = useEditor(
    {
      editable,
      enableContentCheck: false,
      autofocus: autofocus ?? (editable ? "end" : false),
      immediatelyRender: false,
      extensions: createCollaborativeTextEditorExtensions({
        format,
        placeholder: "Press '/' for commands…",
        document: ydoc,
        awareness,
        user,
      }),
      editorProps,
      onUpdate: ({ transaction, editor: ed }) => {
        if (isChangeOrigin(transaction)) return;
        onContentChangeRef.current?.(() => getAcceptedTextEditorContent(ed, format));
      },
      onSelectionUpdate: ({ editor: ed }) => {
        ed.commands.updateUser(user);
      },
    },
    [ydoc, awareness, format, user.color, user.name],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  const { sourceValue, onSourceChange, onSourceFocus, onSourceBlur } = useTextEditorSourceSync({
    editor,
    format,
    viewSource,
    onUpdate: onContentChange
      ? ({ content }) => {
          onContentChange(() => content);
        }
      : undefined,
  });

  useEffect(() => {
    editor?.commands.updateUser(user);
  }, [editor, user]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  const formatBarConfig = (() => {
    if (formatBar === false) return null;
    const config: TextEditorFormatBarConfig = typeof formatBar === "object" ? { ...formatBar } : {};
    config.showPrint ??= false;
    return resolveTextEditorFormatBarConfig(config);
  })();

  const formatBarElement = formatBarConfig ? (
    <TextEditorFormatBar
      editor={editor}
      groups={[...formatBarConfig.groups]}
      showPrint={formatBarConfig.showPrint}
      formattingDisabled={formattingDisabled}
      className={formatBarConfig.className}
      commentControl={
        !viewSource && commentControlLabels && onAddCommentFromSelection ? (
          <DocsCollabCommentControl
            labels={commentControlLabels}
            canAddFromSelection={canAddCommentFromSelection}
            commentsDisabled={commentsDisabled}
            commentsDisabledTitle={commentsDisabledTitle}
            onAddCommentFromSelection={onAddCommentFromSelection}
          />
        ) : undefined
      }
      trailing={
        viewSource || !showSuggestControls ? undefined : (
          <DocsCollabSuggestControls editor={editor} />
        )
      }
    />
  ) : null;

  const sheetElement = (
    <TextEditorSheet
      editor={editor}
      variant="sheet"
      fill={sheetFill}
      slashMenu={format !== "text" && editable}
      overlay={
        commentsOverlay || suggestionsOverlay ? (
          <>
            {commentsOverlay}
            {suggestionsOverlay}
          </>
        ) : null
      }
      className="min-h-0 flex-1"
    />
  );

  const formatLabel = format === "markdown" ? "Markdown" : format === "text" ? "Text" : "HTML";

  return (
    <div
      className={cn(
        "text-editor flex w-full flex-col",
        sheetFill ? "h-full min-h-0 flex-1" : "h-full w-full",
        viewSource && "text-editor--view-source",
        className,
      )}
    >
      {viewSource ? (
        <div className="text-editor__body min-h-0 flex-1">
          <TextEditorSource
            value={sourceValue}
            onChange={onSourceChange}
            onFocus={onSourceFocus}
            onBlur={onSourceBlur}
            editable={editable}
            formatLabel={formatLabel}
            className="text-editor__source min-h-0"
          />
          <div className="text-editor__formatted flex min-h-0 flex-1 flex-col">
            {formatBarElement}
            {sheetElement}
          </div>
        </div>
      ) : (
        <>
          {formatBarElement}
          {sheetElement}
        </>
      )}
    </div>
  );
}
