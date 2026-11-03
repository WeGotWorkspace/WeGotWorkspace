import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Highlight from "@tiptap/extension-highlight";
import { DocsImage } from "@/text-editor-core/src/text-editor-image-extension";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import { TextEditorTaskItem } from "@/text-editor-core/src/text-editor-task-item";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Mark, mergeAttributes, type Extensions } from "@tiptap/react";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import { TrackChangeActiveExtension } from "@/text-editor-core/src/text-editor-suggestion-active";
import { CommentDraftAnchor } from "@/text-editor-core/src/text-editor-comment-draft-anchor";
import {
  DocsTrackChangesExtension,
  createTrackChangesSessionAuthor,
} from "@/text-editor-core/src/text-editor-track-changes-marks";
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
 * Live suggestions are handled by {@link DocsTrackChangesExtension}.
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

const SafeTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    const allowed = this.options.alignments;

    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (el) => {
              const v = el.style.textAlign;
              return allowed.includes(v) ? v : this.options.defaultAlignment;
            },
            renderHTML: (attrs) =>
              typeof attrs.textAlign === "string" && allowed.includes(attrs.textAlign)
                ? { style: `text-align: ${attrs.textAlign}` }
                : {},
          },
        },
      },
    ];
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
    TextEditorTaskItem.configure({ nested: true }),
    SafeTextAlign.configure({ types: ["heading", "paragraph"] }),
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
  /** Remote caret label and colour. Never written into the document. */
  user: { name: string; color: string };
  /**
   * Stable key for this user on this document (principal plus room). The
   * track-changes author id is kept per key, so a remount still claims its
   * earlier marks. Not shown to peers.
   */
  trackChangesUserKey: string;
};

/**
 * Same surface as {@link createTextEditorExtensions} with Yjs + remote carets
 * (undo disabled) plus suggestion mode ({@link DocsTrackChangesExtension}). Starts in
 * `edit` mode; the suggest controls flip it to `suggest`. Suggestions carry only
 * a change id; who made them lives on the suggestion thread.
 */
export function createCollaborativeTextEditorExtensions(
  options: CreateCollaborativeTextEditorExtensionsOptions,
): Extensions {
  const { document, awareness, user, trackChangesUserKey, ...editorOptions } = options;
  const base = createTextEditorExtensions(editorOptions).filter((ext) => ext.name !== "starterKit");

  return [
    StarterKit.configure({ undoRedo: false, link: false, underline: false }),
    ...base,
    DocsTrackChangesExtension.configure({
      author: createTrackChangesSessionAuthor(trackChangesUserKey),
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
