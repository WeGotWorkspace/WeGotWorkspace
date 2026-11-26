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
import { PageBreak } from "@/text-editor-core/src/text-editor-page-break";
import { createTextEditorPagination } from "@/text-editor-core/src/text-editor-pagination";
import type { TextEditorPageSetup } from "@/lib/page-format";

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

/**
 * What a restricted editor (a comment or chat composer) may contain. Text, line breaks and
 * the app's own nodes (`extraExtensions`, e.g. mentions) are always there. Anything not
 * listed is absent from the schema: no input rule makes it, and a paste or pasted markdown
 * that holds it keeps its text and drops the formatting (a heading becomes a paragraph, a
 * table its cell text, an image nothing).
 */
export type TextEditorFeature =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock";

export type CreateTextEditorExtensionsOptions = {
  /**
   * Restrict the schema to these features (and drop Docs-only nodes: tables, tasks, images,
   * headings, highlight, alignment, page breaks). Omit for the full Docs schema.
   */
  allow?: readonly TextEditorFeature[];
  /**
   * Links in comments and chat: `linkify` turns a bare URL in markdown into a link,
   * `openOnClick` makes a rendered (read-only) link follow its href in a new tab.
   */
  links?: { linkify?: boolean; openOnClick?: boolean };
  placeholder?: string;
  format?: TextEditorContentFormat;
  /** Override authenticated image fetch (Storybook / tests). */
  fetchImageContent?: DocsImageContentFetcher;
  /**
   * Docs only: on-screen pages (#1810). The setup and on/off state at mount; later
   * changes go through `applyTextEditorPageSetup`. Notes and Mail leave it out.
   */
  pagination?: { setup: TextEditorPageSetup; enabled: boolean };
  /** App nodes on top of the shared schema (e.g. the chat composer's mention chip). */
  extraExtensions?: Extensions;
};

export function createTextEditorExtensions(
  options: CreateTextEditorExtensionsOptions = {},
): Extensions {
  const format = options.format ?? "html";
  const placeholder =
    options.placeholder ?? (format === "text" ? "Start typing…" : "Press '/' for commands…");

  if (options.allow) return createRestrictedExtensions(options, format, placeholder);

  const extensions: Extensions = [
    // Keep Link/Underline explicitly configured below without duplicating StarterKit marks.
    StarterKit.configure({ link: false, underline: false }),
    Underline,
    linkExtension(options),
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
      // Shared schema so every editor that saves a Doc keeps its breaks; only the
      // Docs slash menu inserts one.
      PageBreak,
    );
  }

  if (options.pagination) {
    extensions.push(
      createTextEditorPagination(options.pagination.setup, options.pagination.enabled),
    );
  }

  if (options.extraExtensions) extensions.push(...options.extraExtensions);

  if (format === "markdown") {
    extensions.push(
      Markdown.configure({
        html: true,
        linkify: options.links?.linkify ?? false,
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

type MarkdownLinkMark = { attrs: { href: string; title?: string | null } };
type MarkdownLinkState = { inBareUrl?: boolean; esc: (text: string) => string };

/** A link whose text is its own address: written as the bare URL, not as `<url>`. */
function isPlainUrlLink(
  mark: MarkdownLinkMark,
  parent: {
    childCount: number;
    child: (index: number) => { isText: boolean; text?: string | null; marks: readonly unknown[] };
  },
  index: number,
): boolean {
  if (mark.attrs.title || !/^\w+:/.test(mark.attrs.href)) return false;
  const content = parent.child(index);
  if (!content.isText || content.text !== mark.attrs.href) return false;
  if (content.marks[content.marks.length - 1] !== mark) return false;
  if (index === parent.childCount - 1) return true;
  return !(parent.child(index + 1).marks as unknown[]).includes(mark);
}

/**
 * Links where a bare URL is a link too (`links.linkify`): the markdown keeps a URL link as
 * the bare URL, so it reads back as a link and carries no `<` `>`; other links stay
 * `[text](url)`. Other editors keep prosemirror-markdown's `<url>` form.
 */
const BareUrlLink = Link.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(state: MarkdownLinkState, mark: MarkdownLinkMark, parent: never, index: number) {
            // The bare form goes through the text escaper, so only a URL it leaves alone is safe.
            state.inBareUrl =
              isPlainUrlLink(mark, parent, index) && state.esc(mark.attrs.href) === mark.attrs.href;
            return state.inBareUrl ? "" : "[";
          },
          close(state: MarkdownLinkState, mark: MarkdownLinkMark) {
            const bare = state.inBareUrl;
            state.inBareUrl = undefined;
            if (bare) return "";
            const title = mark.attrs.title ? ` "${mark.attrs.title.replace(/[\\"]/g, "\\$&")}"` : "";
            return `](${mark.attrs.href.replace(/[()"\n\\]/g, "\\$&")}${title})`;
          },
          mixable: true,
        },
      },
    };
  },
});

function linkExtension(options: CreateTextEditorExtensionsOptions) {
  const configured = {
    openOnClick: options.links?.openOnClick ?? false,
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
  };
  const linkify = options.links?.linkify ?? options.allow !== undefined;
  return (linkify ? BareUrlLink : Link).configure(configured);
}

function createRestrictedExtensions(
  options: CreateTextEditorExtensionsOptions,
  format: TextEditorContentFormat,
  placeholder: string,
): Extensions {
  const allowed = new Set(options.allow);
  const on = (feature: TextEditorFeature) => allowed.has(feature);
  const list = on("bulletList") || on("orderedList");
  const extensions: Extensions = [
    StarterKit.configure({
      link: false,
      underline: false,
      heading: false,
      horizontalRule: false,
      bold: on("bold") ? {} : false,
      italic: on("italic") ? {} : false,
      strike: on("strike") ? {} : false,
      code: on("code") ? {} : false,
      bulletList: on("bulletList") ? {} : false,
      orderedList: on("orderedList") ? {} : false,
      listItem: list ? {} : false,
      listKeymap: list ? {} : false,
      blockquote: on("blockquote") ? {} : false,
      codeBlock: on("codeBlock") ? {} : false,
    }),
    Placeholder.configure({ placeholder }),
  ];
  if (on("link")) extensions.push(linkExtension(options));
  if (options.extraExtensions) extensions.push(...options.extraExtensions);
  if (format === "markdown") {
    extensions.push(
      Markdown.configure({
        // No raw HTML: pasted markdown cannot smuggle in anything the allow-list excludes.
        html: false,
        linkify: options.links?.linkify ?? true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    );
  }
  if (format === "text") extensions.push(PlainTextPaste);
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

const CSS_HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Another person's selection. The tint comes from `.collaboration-carets__selection` in
 * `text-editor.css` (hidden in print); only their color is inline, and only a hex color,
 * since it comes from a collaborator's awareness state.
 */
export function remoteSelectionAttrs(user: Record<string, unknown>) {
  const color = typeof user.color === "string" && CSS_HEX_COLOR.test(user.color) ? user.color : "";
  return {
    nodeName: "span",
    class: "collaboration-carets__selection",
    ...(color ? { style: `--collaboration-carets-color: ${color}` } : {}),
  };
}

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
      selectionRender: remoteSelectionAttrs,
    }),
  ];
}
