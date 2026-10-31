import { Node, canInsertNode, isNodeSelection, mergeAttributes } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

/** Stored form in a Doc's Markdown (#1616). Other Markdown editors drop it, which is wanted. */
export const PAGE_BREAK_MARKDOWN = "<!-- pagebreak -->";

const PAGE_BREAK_COMMENT = /^\s*pagebreak\s*$/i;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert a page break and put the caret in the block after it. */
      setPageBreak: () => ReturnType;
    };
  }
}

type MarkdownSerializeState = {
  write: (text: string) => void;
  closeBlock: (node: unknown) => void;
};

/**
 * Turn `<!-- pagebreak -->` comments in markdown-it's HTML into page-break elements,
 * so the ProseMirror parser (which skips comments) sees them.
 */
export function replacePageBreakComments(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (PAGE_BREAK_COMMENT.test((node as Comment).data)) comments.push(node as Comment);
  }
  for (const comment of comments) {
    const element = doc.createElement("div");
    element.setAttribute("data-type", "page-break");
    comment.replaceWith(element);
  }
}

/**
 * Forced page break: a block atom stored as `<!-- pagebreak -->`. On screen a thin dashed
 * line; in print `break-after: page`. With pages on, the fill plugin in
 * `text-editor-pagination.ts` stretches it to the end of its page.
 *
 * It is in the shared schema (like `DocsImage`) so every helper editor that saves a Doc
 * keeps it; only the Docs slash menu offers it.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },

  // Styled through `[data-type="page-break"]`: HTML output stays a bare element. ProseMirror
  // marks leaf nodes `contenteditable="false"` itself.
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "page-break" })];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain, state }) => {
          if (!canInsertNode(state, state.schema.nodes[this.name])) return false;
          const { selection } = state;
          const currentChain = chain();
          if (isNodeSelection(selection)) {
            currentChain.insertContentAt(selection.$to.pos, { type: this.name });
          } else {
            currentChain.insertContent({ type: this.name });
          }
          return currentChain
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              const { $to } = tr.selection;
              if ($to.nodeAfter?.isTextblock) {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
              } else if ($to.nodeAfter?.isBlock) {
                tr.setSelection(NodeSelection.create(tr.doc, $to.pos));
              } else if (!$to.nodeAfter) {
                const paragraph = tr.doc.type.schema.nodes.paragraph?.create();
                if (paragraph) {
                  const posAfter = $to.end();
                  tr.insert(posAfter, paragraph);
                  tr.setSelection(TextSelection.create(tr.doc, posAfter + 1));
                }
              }
              tr.scrollIntoView();
              return true;
            })
            .run();
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializeState, node: unknown) {
          state.write(PAGE_BREAK_MARKDOWN);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            replacePageBreakComments(element);
          },
        },
      },
    };
  },
});
