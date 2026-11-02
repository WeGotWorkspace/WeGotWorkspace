import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * With pages on, every table row is its own box (`text-editor.css`), so each row would
 * size its columns on its own: equal widths, unlike print, where the table sizes its
 * columns from all its content. This plugin lays out a hidden copy of each table as a
 * plain table at the width it has on the page, reads the column widths, and hands every cell
 * its width through `--text-editor-cell-width`. Decorations only: the document never
 * changes, and without pages the variable is unused.
 */

export const CELL_WIDTH_VAR = "--text-editor-cell-width";

const PAGINATION_CLASS = "rm-with-pagination";
/** Below this a width change is rounding noise, not a new layout. */
const WIDTH_EPSILON_PX = 0.25;

export type TableColumns = { pos: number; widths: readonly number[] };

type PageColumnsState = { columns: TableColumns[]; decorations: DecorationSet };

const pageColumnsKey = new PluginKey<PageColumnsState>("textEditorPageColumns");

export type PageColumnsOptions = {
  isEnabled: () => boolean;
};

/**
 * Tables with their document positions: top-level ones and those in lists or quotes, whose
 * rows are boxes of their own too. Tables nested in a table cell are not listed: they get
 * no column widths.
 */
export function documentTables(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode }[] {
  const tables: { pos: number; node: ProseMirrorNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    tables.push({ pos, node });
    return false;
  });
  return tables;
}

/** One decoration per cell: the sum of the columns it spans. */
export function cellWidthDecorations(
  doc: ProseMirrorNode,
  columns: readonly TableColumns[],
): Decoration[] {
  return columns.flatMap(({ pos, widths }) => {
    const table = doc.nodeAt(pos);
    if (table?.type.name !== "table") return [];
    const map = TableMap.get(table);
    if (map.width !== widths.length) return [];
    const seen = new Set<number>();
    const decorations: Decoration[] = [];
    for (const cellOffset of map.map) {
      if (seen.has(cellOffset)) continue;
      seen.add(cellOffset);
      const cell = table.nodeAt(cellOffset);
      if (!cell) continue;
      const { left, right } = map.findCell(cellOffset);
      const width = widths.slice(left, right).reduce((sum, value) => sum + value, 0);
      const from = pos + 1 + cellOffset;
      decorations.push(
        Decoration.node(from, from + cell.nodeSize, {
          style: `${CELL_WIDTH_VAR}: ${width.toFixed(2)}px`,
        }),
      );
    }
    return decorations;
  });
}

function sameColumns(a: readonly TableColumns[], b: readonly TableColumns[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.pos === b[index]?.pos &&
        entry.widths.length === b[index].widths.length &&
        entry.widths.every(
          (width, col) => Math.abs(width - (b[index].widths[col] ?? 0)) < WIDTH_EPSILON_PX,
        ),
    )
  );
}

/** Content width of `el`, unrounded: for the editor root, the text column inside the margins. */
function contentWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  return (
    el.getBoundingClientRect().width -
    parseFloat(style.paddingLeft || "0") -
    parseFloat(style.paddingRight || "0") -
    parseFloat(style.borderLeftWidth || "0") -
    parseFloat(style.borderRightWidth || "0")
  );
}

/** Width the table may take: its block's container (the text column, a list item, a quote). */
function availableWidth(view: EditorView, table: HTMLTableElement): number {
  const block = table.closest(".tableWrapper") ?? table;
  const container = block.parentElement;
  return container && container !== view.dom ? contentWidth(container) : contentWidth(view.dom);
}

function tableElement(view: EditorView, pos: number): HTMLTableElement | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  return dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
}

/**
 * Column widths of `table` laid out as a plain table `width` px wide (as print does).
 * Each width is the box of a cell spanning only that column: a `<col>` has no layout box
 * in Firefox or Safari. A column with no such cell falls back to its `<col>`.
 */
function measureColumns(
  view: EditorView,
  table: HTMLTableElement,
  node: ProseMirrorNode,
  width: number,
): number[] {
  const host = view.dom.parentElement;
  if (!host) return [];
  const probe = document.createElement("div");
  // The prose class brings the table, cell and text styles; no pagination class, so
  // the table is a table again.
  probe.className = "text-editor-prose";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style;width:${width}px`;
  probe.appendChild(table.cloneNode(true));
  host.appendChild(probe);
  try {
    const map = TableMap.get(node);
    const cols = probe.querySelectorAll(":scope > table > colgroup > col");
    const rows = probe.querySelectorAll(":scope > table > tbody > tr");
    const widths: number[] = Array.from({ length: map.width }, () => 0);
    for (let row = 0; row < map.height; row += 1) {
      const cells = rows[row]?.children;
      if (!cells) continue;
      let index = 0;
      for (let col = 0; col < map.width; col += 1) {
        const rect = map.findCell(map.map[row * map.width + col]);
        if (rect.top !== row || rect.left !== col) continue;
        const cell = cells[index];
        index += 1;
        if (rect.right - rect.left === 1 && cell && widths[col] === 0) {
          widths[col] = cell.getBoundingClientRect().width;
        }
      }
    }
    return widths.map((value, col) => value || (cols[col]?.getBoundingClientRect().width ?? 0));
  } finally {
    probe.remove();
  }
}

/** Bumped when late layout (images, fonts) may have changed column widths. */
let layoutGeneration = 0;

/** Last measurement per table node: unchanged tables at the same width are not measured again. */
const measured = new WeakMap<
  ProseMirrorNode,
  { width: number; widths: number[]; generation: number }
>();

function currentColumns(view: EditorView, options: PageColumnsOptions): TableColumns[] {
  if (!options.isEnabled() || !view.dom.classList.contains(PAGINATION_CLASS)) return [];
  const tables = documentTables(view.state.doc);
  if (tables.length === 0) return [];
  return tables.flatMap(({ pos, node }) => {
    const table = tableElement(view, pos);
    if (!table) return [];
    const width = availableWidth(view, table);
    if (!(width > 0)) return [];
    const cached = measured.get(node);
    if (
      cached &&
      cached.generation === layoutGeneration &&
      Math.abs(cached.width - width) < WIDTH_EPSILON_PX
    ) {
      return [{ pos, widths: cached.widths }];
    }
    const widths = measureColumns(view, table, node, width);
    if (widths.length !== TableMap.get(node).width || !widths.every((w) => w > 0)) return [];
    const imagesPending = Array.from(table.querySelectorAll("img")).some((img) => !img.complete);
    if (!imagesPending) measured.set(node, { width, widths, generation: layoutGeneration });
    return [{ pos, widths }];
  });
}

function mapColumns(columns: readonly TableColumns[], tr: Transaction): TableColumns[] {
  return columns.flatMap((entry) => {
    const result = tr.mapping.mapResult(entry.pos, 1);
    return result.deleted ? [] : [{ pos: result.pos, widths: entry.widths }];
  });
}

export function createPageColumnsPlugin(options: PageColumnsOptions): Plugin<PageColumnsState> {
  return new Plugin<PageColumnsState>({
    key: pageColumnsKey,
    state: {
      init: () => ({ columns: [], decorations: DecorationSet.empty }),
      apply(tr, state) {
        const next = tr.getMeta(pageColumnsKey) as TableColumns[] | undefined;
        if (next) {
          return {
            columns: next,
            decorations: DecorationSet.create(tr.doc, cellWidthDecorations(tr.doc, next)),
          };
        }
        if (!tr.docChanged) return state;
        return {
          columns: mapColumns(state.columns, tr),
          decorations: state.decorations.map(tr.mapping, tr.doc),
        };
      },
    },
    props: {
      decorations: (state) => pageColumnsKey.getState(state)?.decorations,
    },
    view(view) {
      let frame: number | null = null;
      const sync = () => {
        frame = null;
        if (view.isDestroyed) return;
        const next = currentColumns(view, options);
        const current = pageColumnsKey.getState(view.state)?.columns ?? [];
        if (sameColumns(next, current)) return;
        view.dispatch(view.state.tr.setMeta(pageColumnsKey, next).setMeta("addToHistory", false));
      };
      const schedule = () => {
        if (frame != null || typeof requestAnimationFrame !== "function") return;
        frame = requestAnimationFrame(sync);
      };
      const relayout = () => {
        layoutGeneration += 1;
        schedule();
      };
      view.dom.addEventListener("load", relayout, true);
      void document.fonts?.ready.then(relayout);
      schedule();
      return {
        // Measuring waits for the next frame, so a burst of typing measures once.
        update: schedule,
        destroy() {
          view.dom.removeEventListener("load", relayout, true);
          if (frame != null) cancelAnimationFrame(frame);
        },
      };
    },
  });
}
