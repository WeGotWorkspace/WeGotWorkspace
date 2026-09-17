import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Highlight from "@tiptap/extension-highlight";
import { DocsImage } from "@/text-editor-core/src/text-editor-image-extension";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Mark, mergeAttributes, type Extensions } from "@tiptap/react";
import { TrackChangesExtension } from "tiptap-track-changes";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import { TrackChangeActiveExtension } from "@/text-editor-core/src/text-editor-suggestion-active";
import { CommentDraftAnchor } from "@/text-editor-core/src/text-editor-comment-draft-anchor";
import { toTrackChangesAuthor } from "@/text-editor-core/src/text-editor-track-changes";
import { Markdown } from "tiptap-markdown";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import { PlainTextPaste } from "@/text-editor-core/src/text-editor-plain-paste";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";

export { CommentMark };
export {
  CommentDraftAnchor,
  setCommentDraftAnchor,
} from "@/text-editor-core/src/text-editor-comment-draft-anchor";

/**
 * Legacy static highlight mark — predates live track-changes suggestions and is
 * kept only for stored documents that still carry `data-suggestion-id` spans.
 * Live suggestions are handled by {@link TrackChangesExtension}.
 */
export const LegacySuggestionMark = Mark.create({
  name: "legacySuggestion",
  inclusive: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-suggestion-id"),
        renderHTML: (attrs) => (attrs.id ? { "data-suggestion-id": attrs.id } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "legacy-suggestion-mark" }), 0];
  },
});

export type CreateTextEditorExtensionsOptions = {
  placeholder?: string;
  format?: TextEditorContentFormat;
  /** Override authenticated image fetch (Storybook / tests). */
  fetchImageContent?: DocsImageContentFetcher;
};

export function createTextEditorExtensions(
  options: CreateTextEditorExtensionsOptions = {},
): Extensions {
  const format = options.format ?? "html";
  const placeholder =
    options.placeholder ?? (format === "text" ? "Start typing…" : "Press '/' for commands…");

  const extensions: Extensions = [
    // Keep Link/Underline explicitly configured below without duplicating StarterKit marks.
    StarterKit.configure({ link: false, underline: false }),
    Underline,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder }),
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Typography,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CommentMark,
    CommentDraftAnchor,
    LegacySuggestionMark,
  ];

  if (format !== "text") {
    extensions.push(
      options.fetchImageContent
        ? DocsImage.configure({ fetchContent: options.fetchImageContent })
        : DocsImage,
    );
  }

  if (format === "markdown") {
    extensions.push(
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    );
  }

  if (format === "text") {
    extensions.push(PlainTextPaste);
  }

  return extensions;
}

export type CreateCollaborativeTextEditorExtensionsOptions = CreateTextEditorExtensionsOptions & {
  document: Y.Doc;
  awareness: Awareness;
  /** `id` is optional; a stable author id is derived from `name` when omitted. */
  user: { name: string; color: string; id?: string };
};

/**
 * Same surface as {@link createTextEditorExtensions} with Yjs + remote carets
 * (undo disabled) plus MIT `tiptap-track-changes` for suggestion mode. Starts in
 * `edit` mode; the suggest controls flip it to `suggest`.
 */
export function createCollaborativeTextEditorExtensions(
  options: CreateCollaborativeTextEditorExtensionsOptions,
): Extensions {
  const { document, awareness, user, ...editorOptions } = options;
  const base = createTextEditorExtensions(editorOptions).filter((ext) => ext.name !== "starterKit");

  return [
    StarterKit.configure({ undoRedo: false, link: false, underline: false }),
    ...base,
    TrackChangesExtension.configure({
      author: toTrackChangesAuthor(user),
      mode: "edit",
    }),
    TrackChangeActiveExtension,
    Collaboration.configure({ document }),
    CollaborationCaret.configure({
      provider: { awareness },
      user,
    }),
  ];
}
