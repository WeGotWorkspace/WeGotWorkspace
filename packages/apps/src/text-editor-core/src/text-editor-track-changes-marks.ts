import { mergeAttributes, type Attribute } from "@tiptap/core";
import {
  DeletionMark,
  FormatChangeMark,
  InsertionMark,
  TrackChangesExtension,
  type ChangeAuthor,
} from "tiptap-track-changes";

/**
 * Suggestion marks we own on top of `tiptap-track-changes`.
 *
 * The library marks write `data-author-id`, `data-author-name` and an
 * `--author-color` style into the document. Those travel in every download,
 * copy and sidecar, so our marks keep only the change id (and the format names
 * of a format change). Author and time live on the suggestion thread.
 *
 * `authorName` / `authorColor` are not declared, so ProseMirror drops them from
 * the model (and from the Yjs state) even when an older document still has
 * them. `authorId` and `timestamp` stay in the model because the library uses
 * `authorId` to grow one insertion while the same session types; neither is
 * ever rendered.
 */

const PRIORITY_ABOVE_STRIKE = 60;

const modelOnly: Partial<Attribute> = {
  default: null,
  parseHTML: () => null,
  renderHTML: () => ({}),
};

/** `attr` in the model, `data-…` in HTML. The library default reads `getAttribute(attr)`, which never matches. */
function dataAttribute(attr: string, htmlName: string): Partial<Attribute> {
  return {
    default: null,
    parseHTML: (element) => element.getAttribute(htmlName),
    renderHTML: (attrs) => (attrs[attr] ? { [htmlName]: attrs[attr] } : {}),
  };
}

const changeAttributes = () => ({
  changeId: dataAttribute("changeId", "data-change-id"),
  authorId: modelOnly,
  timestamp: modelOnly,
});

export const DocsInsertionMark = InsertionMark.extend({
  addAttributes: changeAttributes,
  parseHTML() {
    return [{ tag: "ins[data-change-id]", priority: PRIORITY_ABOVE_STRIKE }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
});

export const DocsDeletionMark = DeletionMark.extend({
  addAttributes: changeAttributes,
  parseHTML() {
    // `del` is also a Strike tag; a tracked deletion must win.
    return [{ tag: "del[data-change-id]", priority: PRIORITY_ABOVE_STRIKE }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["del", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
});

export const DocsFormatChangeMark = FormatChangeMark.extend({
  addAttributes() {
    return {
      ...changeAttributes(),
      formatAdded: dataAttribute("formatAdded", "data-format-added"),
      formatRemoved: dataAttribute("formatRemoved", "data-format-removed"),
    };
  },
  parseHTML() {
    return [{ tag: "span[data-format-change]", priority: PRIORITY_ABOVE_STRIKE }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    const title = [
      mark.attrs.formatAdded ? `Added: ${mark.attrs.formatAdded}` : "",
      mark.attrs.formatRemoved ? `Removed: ${mark.attrs.formatRemoved}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return [
      "span",
      mergeAttributes(
        this.options.HTMLAttributes,
        { "data-format-change": "true" },
        HTMLAttributes,
        {
          ...(title ? { title } : {}),
        },
      ),
      0,
    ];
  },
});

const NODE_TRACKING_AUTHOR_KEYS = ["authorId", "authorName", "authorColor"] as const;

/** Block-level tracking (`dataTracked`) without who made the change. */
export function withoutNodeTrackingAuthor(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const next = { ...(value as Record<string, unknown>) };
  for (const key of NODE_TRACKING_AUTHOR_KEYS) delete next[key];
  return next;
}

type GlobalAttributes = {
  types: string[];
  attributes: Record<string, Partial<Attribute>>;
}[];

/**
 * {@link TrackChangesExtension} with our marks and an author-free `data-tracked`
 * attribute on block nodes (paragraph inserts, block joins, type changes).
 */
export const DocsTrackChangesExtension = TrackChangesExtension.extend({
  addExtensions() {
    return [DocsInsertionMark, DocsDeletionMark, DocsFormatChangeMark];
  },
  addGlobalAttributes() {
    const parent = (this.parent?.() ?? []) as GlobalAttributes;
    return parent.map((entry) => {
      const tracked = entry.attributes.dataTracked;
      if (!tracked) return entry;
      return {
        ...entry,
        attributes: {
          ...entry.attributes,
          dataTracked: {
            ...tracked,
            parseHTML: (element: HTMLElement) =>
              withoutNodeTrackingAuthor(tracked.parseHTML?.(element) ?? null),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.dataTracked
                ? {
                    "data-tracked": JSON.stringify(withoutNodeTrackingAuthor(attrs.dataTracked)),
                  }
                : {},
          },
        },
      };
    });
  },
});

function randomSessionToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Track-changes author for one editor session. The id is random so it says
 * nothing about the person; it only lets the library group one session's
 * typing into a single insertion. Name and colour stay empty: the suggestion
 * thread carries who made the change.
 */
export function createTrackChangesSessionAuthor(): ChangeAuthor {
  return { id: `tc_${randomSessionToken()}`, name: "", color: "" };
}
