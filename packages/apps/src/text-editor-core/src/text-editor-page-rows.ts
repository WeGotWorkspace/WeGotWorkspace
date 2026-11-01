import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * With pages on, every table row is its own box, so a row moves to the next page whole.
 * A row taller than one page fits on no page and would push pages out forever. Such a
 * row gets `text-editor-row--stacked`: its cells stack as plain blocks whose lines flow
 * across page ends. A decoration, so ProseMirror owns the class and the document is
 * never touched.
 */

export const STACKED_ROW_CLASS = "text-editor-row--stacked";

const pageRowsKey = new PluginKey<DecorationSet>("textEditorPageRows");
const PAGINATION_CLASS = "rm-with-pagination";

export type PageRowsOptions = {
  isEnabled: () => boolean;
  /** Height of one page's content area in CSS px. */
  contentHeight: () => number;
};

/** Positions of the rows of top-level tables. */
export function tableRowPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.forEach((child, offset) => {
    if (child.type.name !== "table") return;
    child.forEach((_row, rowOffset) => positions.push(offset + 1 + rowOffset));
  });
  return positions;
}

/**
 * Rows taller than a page. A stacked row is never shorter than the same row as a table
 * row, so a row stays stacked until its stacked height fits: no flip-flopping.
 */
function oversizeRows(view: EditorView, options: PageRowsOptions): number[] {
  if (!options.isEnabled() || !view.dom.classList.contains(PAGINATION_CLASS)) return [];
  const limit = options.contentHeight();
  if (!(limit > 0)) return [];
  return tableRowPositions(view.state.doc).filter((pos) => {
    const dom = view.nodeDOM(pos);
    return dom instanceof HTMLElement && dom.getBoundingClientRect().height > limit;
  });
}

function stackedRows(view: EditorView): number[] {
  return (pageRowsKey.getState(view.state)?.find() ?? []).map((deco) => deco.from);
}

function sameRows(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((pos, index) => pos === b[index]);
}

function rowDecorations(doc: ProseMirrorNode, positions: readonly number[]): DecorationSet {
  const decorations = positions.flatMap((pos) => {
    const row = doc.nodeAt(pos);
    if (row?.type.name !== "tableRow") return [];
    return [Decoration.node(pos, pos + row.nodeSize, { class: STACKED_ROW_CLASS })];
  });
  return DecorationSet.create(doc, decorations);
}

export function createPageRowsPlugin(options: PageRowsOptions): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: pageRowsKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(pageRowsKey) as number[] | undefined;
        if (next) return rowDecorations(tr.doc, next);
        return set.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => pageRowsKey.getState(state),
    },
    view(view) {
      let frame: number | null = null;
      const sync = () => {
        frame = null;
        if (view.isDestroyed) return;
        const next = oversizeRows(view, options);
        if (sameRows(next, stackedRows(view))) return;
        view.dispatch(view.state.tr.setMeta(pageRowsKey, next).setMeta("addToHistory", false));
      };
      return {
        update(updatedView) {
          if (frame != null || typeof requestAnimationFrame !== "function") return;
          if (sameRows(oversizeRows(updatedView, options), stackedRows(updatedView))) return;
          frame = requestAnimationFrame(sync);
        },
        destroy() {
          if (frame != null) cancelAnimationFrame(frame);
        },
      };
    },
  });
}
