/**
 * Pure selection model for the cell grid. Positions are indexes into the current
 * row/column order; the grid maps them to row ids when it writes. Nothing here
 * depends on which rows are rendered, so a virtualized body can use it as is.
 */
export type Cell = { r: number; c: number };
export type Range = { r1: number; c1: number; r2: number; c2: number };

export type Selection = {
  /** The cell that takes typing; always inside the last range. */
  active: Cell;
  /** The fixed corner of the last range (Shift+click / Shift+arrow extend from here). */
  anchor: Cell;
  /** All ranges; the last one is the one being extended. Cmd/Ctrl+click adds one. */
  ranges: Range[];
};

export type Bounds = { rows: number; cols: number };

export function clampCell(cell: Cell, bounds: Bounds): Cell {
  return {
    r: Math.max(0, Math.min(bounds.rows - 1, cell.r)),
    c: Math.max(0, Math.min(bounds.cols - 1, cell.c)),
  };
}

export function rangeOf(a: Cell, b: Cell): Range {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export function single(cell: Cell): Selection {
  return { active: cell, anchor: cell, ranges: [rangeOf(cell, cell)] };
}

export function inRange(range: Range, r: number, c: number): boolean {
  return r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
}

export function isSelected(sel: Selection, r: number, c: number): boolean {
  return sel.ranges.some((range) => inRange(range, r, c));
}

export function lastRange(sel: Selection): Range {
  return sel.ranges[sel.ranges.length - 1] ?? rangeOf(sel.active, sel.active);
}

/** Extend the last range from the anchor to `to` (Shift+click, Shift+arrow, drag). */
export function extendTo(sel: Selection, to: Cell): Selection {
  const ranges = sel.ranges.slice(0, -1);
  ranges.push(rangeOf(sel.anchor, to));
  return { active: sel.active, anchor: sel.anchor, ranges };
}

/** Add a new range (Cmd/Ctrl+click). */
export function addRange(sel: Selection, cell: Cell): Selection {
  return { active: cell, anchor: cell, ranges: [...sel.ranges, rangeOf(cell, cell)] };
}

/** The moving corner of the last range: the end opposite the anchor. */
export function focusCorner(sel: Selection): Cell {
  const range = lastRange(sel);
  return {
    r: sel.anchor.r === range.r1 ? range.r2 : range.r1,
    c: sel.anchor.c === range.c1 ? range.c2 : range.c1,
  };
}

export type Dir = "up" | "down" | "left" | "right";

const DELTA: Record<Dir, Cell> = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };

export function step(cell: Cell, dir: Dir, bounds: Bounds): Cell {
  const d = DELTA[dir];
  return clampCell({ r: cell.r + d.r, c: cell.c + d.c }, bounds);
}

/**
 * Cmd/Ctrl+arrow: Excel's data-edge jump. From a filled cell whose neighbour is
 * filled, go to the last filled cell of that block; otherwise go to the next filled
 * cell, or to the sheet edge when there is none.
 */
export function dataEdge(from: Cell, dir: Dir, bounds: Bounds, isEmpty: (r: number, c: number) => boolean): Cell {
  const d = DELTA[dir];
  const inside = (cell: Cell) => cell.r >= 0 && cell.c >= 0 && cell.r < bounds.rows && cell.c < bounds.cols;
  let cur = from;
  const next = (cell: Cell) => ({ r: cell.r + d.r, c: cell.c + d.c });
  const first = next(cur);
  if (!inside(first)) return from;
  const fromFilled = !isEmpty(from.r, from.c);
  const nextFilled = !isEmpty(first.r, first.c);
  if (fromFilled && nextFilled) {
    cur = first;
    for (;;) {
      const n = next(cur);
      if (!inside(n) || isEmpty(n.r, n.c)) return cur;
      cur = n;
    }
  }
  cur = first;
  for (;;) {
    if (!isEmpty(cur.r, cur.c)) return cur;
    const n = next(cur);
    if (!inside(n)) return cur;
    cur = n;
  }
}

/** Plain arrow: collapse to one cell and move. */
export function move(sel: Selection, dir: Dir, bounds: Bounds): Selection {
  return single(step(sel.active, dir, bounds));
}

/** Shift+arrow: move the focus corner, keep the anchor. */
export function extend(sel: Selection, dir: Dir, bounds: Bounds): Selection {
  return extendTo(sel, step(focusCorner(sel), dir, bounds));
}

export function extendToEdge(
  sel: Selection,
  dir: Dir,
  bounds: Bounds,
  isEmpty: (r: number, c: number) => boolean,
): Selection {
  return extendTo(sel, dataEdge(focusCorner(sel), dir, bounds, isEmpty));
}

/**
 * Enter/Tab inside a multi-cell range walk the active cell through the range
 * without losing it (Excel and Sheets both do this).
 */
export function cycleWithin(sel: Selection, dir: "down" | "up" | "right" | "left", bounds: Bounds): Selection {
  const range = lastRange(sel);
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2 || sel.ranges.length > 1;
  if (!multi) return move(sel, dir, bounds);
  let { r, c } = sel.active;
  const width = range.c2 - range.c1 + 1;
  const height = range.r2 - range.r1 + 1;
  if (dir === "down" || dir === "up") {
    let idx = (c - range.c1) * height + (r - range.r1) + (dir === "down" ? 1 : -1);
    const total = width * height;
    idx = (idx + total) % total;
    c = range.c1 + Math.floor(idx / height);
    r = range.r1 + (idx % height);
  } else {
    let idx = (r - range.r1) * width + (c - range.c1) + (dir === "right" ? 1 : -1);
    const total = width * height;
    idx = (idx + total) % total;
    r = range.r1 + Math.floor(idx / width);
    c = range.c1 + (idx % width);
  }
  return { ...sel, active: { r, c } };
}

export function selectAll(bounds: Bounds, active: Cell): Selection {
  return { active, anchor: { r: 0, c: 0 }, ranges: [{ r1: 0, c1: 0, r2: bounds.rows - 1, c2: bounds.cols - 1 }] };
}

export function selectRows(from: number, to: number, bounds: Bounds, keepActiveCol = 0): Selection {
  const active = { r: from, c: keepActiveCol };
  return {
    active,
    anchor: { r: from, c: 0 },
    ranges: [{ r1: Math.min(from, to), c1: 0, r2: Math.max(from, to), c2: bounds.cols - 1 }],
  };
}

export function selectCols(from: number, to: number, bounds: Bounds, keepActiveRow = 0): Selection {
  const active = { r: keepActiveRow, c: from };
  return {
    active,
    anchor: { r: 0, c: from },
    ranges: [{ r1: 0, c1: Math.min(from, to), r2: bounds.rows - 1, c2: Math.max(from, to) }],
  };
}

export function isWholeRows(range: Range, bounds: Bounds): boolean {
  return range.c1 === 0 && range.c2 === bounds.cols - 1;
}

export function isWholeCols(range: Range, bounds: Bounds): boolean {
  return range.r1 === 0 && range.r2 === bounds.rows - 1;
}

/** Bounding box of every range (for copy of a multi-range that shares rows or columns). */
export function boundingBox(ranges: Range[]): Range {
  return ranges.reduce(
    (acc, r) => ({ r1: Math.min(acc.r1, r.r1), c1: Math.min(acc.c1, r.c1), r2: Math.max(acc.r2, r.r2), c2: Math.max(acc.c2, r.c2) }),
    { r1: Infinity, c1: Infinity, r2: -Infinity, c2: -Infinity },
  );
}

/** Keep a selection inside new bounds after rows/columns go away. */
export function clampSelection(sel: Selection, bounds: Bounds): Selection {
  if (bounds.rows === 0 || bounds.cols === 0) return single({ r: 0, c: 0 });
  const clampRange = (range: Range): Range => {
    const a = clampCell({ r: range.r1, c: range.c1 }, bounds);
    const b = clampCell({ r: range.r2, c: range.c2 }, bounds);
    return rangeOf(a, b);
  };
  return { active: clampCell(sel.active, bounds), anchor: clampCell(sel.anchor, bounds), ranges: sel.ranges.map(clampRange) };
}
