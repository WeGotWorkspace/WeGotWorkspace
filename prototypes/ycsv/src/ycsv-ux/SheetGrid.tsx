import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { isCellError, type Value } from "../ycsv-formula/eval";
import { formatValue } from "../ycsv-grid/format";
import { useSheet } from "../ycsv-grid/useSheet";
import { readIncoming, toHtml, toTsv, type Incoming, type YcsvClip } from "./clipboard";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fillSeries } from "./fill";
import {
  insertAt,
  refHighlights,
  refText,
  REF_COLORS,
  segments,
  signatureAt,
  suggest,
  wantsRef,
  type RefResolver,
  type Segment,
} from "./formula-assist";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  LOCAL,
  makeUndoManager,
  moveColumns,
  moveRows,
  setColumnWidth,
  setFrozenRows,
  writeCells,
  type CellWrite,
} from "./ops";
import { planPaste } from "./paste";
import {
  addRange,
  clampSelection,
  cycleWithin,
  dataEdge,
  extend,
  extendTo,
  extendToEdge,
  inRange,
  isSelected,
  isWholeCols,
  isWholeRows,
  lastRange,
  move,
  rangeOf,
  selectAll,
  selectCols,
  selectRows,
  single,
  step,
  type Cell,
  type Dir,
  type Range,
  type Selection,
} from "./selection";
import { shiftFormula } from "./shift";
import { readSnap } from "./snapshot";
import {
  clampZoom,
  edgeSpeed,
  FORMULA_KEYS,
  HOLD_CANCEL_PX,
  HOLD_DRAG_PX,
  HOLD_MS,
  loadZoom,
  MENU_MS,
  saveZoom,
  useCoarsePointer,
  useVisualViewport,
  type TouchVariant,
} from "./touch";
import "./SheetGrid.css";

type User = { id: string; name: string; color: string };
type Props = {
  doc: Y.Doc;
  theme?: "light" | "dark";
  height?: number | string;
  awareness?: Awareness;
  user?: User;
  /**
   * Spike 7. "a": tap, double-tap, long-press menu, finger fill handle.
   * "b": A plus draggable range handles (fill moves into the menu).
   * "c": B plus hold-to-drag (Calendar parity): hold, then drag selects a range,
   * moves a row or column, or resizes a column from its header edge.
   */
  touchVariant?: TouchVariant;
  /** Variant C hold time before a drag arms. Default HOLD_MS (160, as Calendar). */
  holdMs?: number;
  /** Variant C travel (px) before the hold arms that makes it a pan. Default HOLD_CANCEL_PX (10, as Calendar). */
  holdSlop?: number;
  /** Rows rendered above and below the visible ones. Default: 4, or 12 with a finger. */
  overscan?: number;
};

type EditState = {
  r: number;
  c: number;
  /** "enter": typed over the cell, arrows leave or point. "edit": F2/Enter, arrows move the caret. */
  mode: "enter" | "edit";
  draft: string;
  caret: number;
  /** Length of the reference pointing just inserted before the caret. */
  picked: number;
  pickAnchor: Cell | null;
  pickCursor: Cell | null;
  source: "cell" | "bar";
};

type Drag =
  | { kind: "select" }
  | { kind: "pick"; start: Cell }
  | { kind: "fill"; range: Range }
  | { kind: "headers"; axis: "row" | "col"; anchor: number; add: boolean }
  | { kind: "move"; axis: "row" | "col"; from: number; count: number; startX: number; startY: number; moved: boolean; hit: number }
  | { kind: "resize"; col: number; colIds: string[]; startX: number; startW: number }
  | {
      kind: "touch";
      startX: number;
      startY: number;
      cell: Cell;
      zone: Hit["zone"];
      moved: boolean;
      timer: number;
      /** Variant C: the hold timer, and whether it fired (the finger now owns the gesture). */
      hold: number;
      armed: boolean;
      pointerId: number;
      /** Hit position in content coordinates, for the header-edge resize check. */
      x: number;
    }
  /** Spike 7 variant B: a range handle. `fixed` is the opposite corner; `dx/dy` keep the handle under the finger's grab point. */
  | { kind: "handle"; axis: "cell" | "row" | "col"; end: boolean; fixed: Cell; dx: number; dy: number };

type Hit = { zone: "cell" | "colhead" | "rowhead" | "corner"; r: number; c: number; x: number; y: number };

const HEADER_H = 30;
/** Variant C: a hold-drag that starts this close (content px) to a column header edge resizes. */
const RESIZE_EDGE = 12;
const DEFAULT_W = 120;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);
const MOD = isMac ? "⌘" : "Ctrl+";

const ERROR_HELP: Record<string, string> = {
  "#REF": "Points at a row or column that no longer exists.",
  "#CYCLE": "The formula depends on itself.",
  "#NAME": "Unknown function or name.",
  "#VALUE": "A value has the wrong type for this operation.",
  "#DIV/0": "Division by zero.",
  "#SYNTAX": "The formula cannot be read.",
};

const BARE = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*$/;
const fileRef = (ref: string) => (BARE.test(ref) ? ref : `'${ref.replaceAll("'", "''")}'`);

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font = "13px system-ui, -apple-system, 'Segoe UI', sans-serif"): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function rangeLabel(range: Range, colRef: (c: number) => string): string {
  const a = `${colRef(range.c1)}${range.r1 + 1}`;
  if (range.r1 === range.r2 && range.c1 === range.c2) return a;
  return `${a}:${colRef(range.c2)}${range.r2 + 1}`;
}

/** Excel's "General": a computed number in an untyped column shows at most 12 significant digits. */
function showValue(value: Value, col: Parameters<typeof formatValue>[1]): string {
  if (typeof value === "number" && (!col.type || col.type === "string")) return String(Number(value.toPrecision(12)));
  return formatValue(value, col);
}

function valueToString(value: Value | undefined): string {
  if (value === undefined) return "";
  if (isCellError(value)) return `${value}!`;
  return String(value);
}

type SheetRow = ReturnType<typeof useSheet>["rows"][number];
type SheetCol = ReturnType<typeof useSheet>["columns"][number];

/**
 * One rendered row. Memoised: while scrolling only rows that enter the window
 * render; rows that stay are skipped unless their data or selection changed.
 */
const GridRow = memo(function GridRow(props: {
  row: SheetRow;
  r: number;
  top: number;
  rowH: number;
  rowHeadW: number;
  totalW: number;
  columns: SheetCol[];
  values: Map<string, Value>;
  lefts: number[];
  widths: number[];
  gridId: string;
  /** Selected column spans in this row: "c1-c2,c1-c2,". */
  cover: string;
  activeC: number;
  editing: boolean;
  head: "" | "sel" | "whole";
  /** Variant B row-header handles: 1 = start, 2 = end. */
  headHandle: number;
}) {
  const { row, r, top, rowH, rowHeadW, totalW, columns, values, lefts, widths, gridId, cover, activeC, editing, head, headHandle } = props;
  const spans = cover ? cover.slice(0, -1).split(",").map((x) => x.split("-").map(Number) as [number, number]) : [];
  const knob = (end: boolean) => (
    <div
      className={`sx-handle is-${end ? "end" : "start"} is-row`}
      data-handle={end ? "end" : "start"}
      data-axis="row"
      data-testid={`handle-${end ? "end" : "start"}`}
      aria-hidden="true"
      style={{ left: "50%", top: end ? "100%" : 0 }}
    />
  );
  return (
    <div role="row" aria-rowindex={r + 2} className="sx-row" style={{ top, height: rowH, width: totalW + rowHeadW }}>
      <div
        role="rowheader"
        className={`sx-rowhead${head === "whole" ? " is-whole" : head === "sel" ? " is-sel" : ""}`}
        style={{ position: "sticky", left: 0, width: rowHeadW, height: rowH, zIndex: headHandle ? 3 : 2, background: "var(--sx-head-bg)", borderRight: "1px solid var(--sx-line-strong)" }}
      >
        {r + 1}
        {headHandle & 1 ? knob(false) : null}
        {headHandle & 2 ? knob(true) : null}
      </div>
      {columns.map((col, c) => {
        const value = values.get(`${col.ref}@${row.rowId}`);
        const err = isCellError(value);
        const selected = spans.some(([a, b]) => c >= a && c <= b);
        const isActive = c === activeC;
        const text = value === undefined || value === "" ? "" : showValue(value, col);
        return (
          <div
            key={col.colId}
            id={`${gridId}-cell-${r}-${c}`}
            role="gridcell"
            aria-colindex={c + 2}
            aria-selected={selected}
            title={err ? ERROR_HELP[value as string] : undefined}
            className={`sx-cell${typeof value === "number" ? " is-num" : ""}${err ? " is-error" : ""}${isActive ? " is-active" : ""}`}
            style={{ left: rowHeadW + (lefts[c] ?? 0), width: widths[c] }}
          >
            {isActive && editing ? "" : text}
          </div>
        );
      })}
    </div>
  );
});

export function SheetGrid({ doc, theme = "light", height = "100%", awareness, user, touchVariant = "a", overscan, holdMs = HOLD_MS, holdSlop = HOLD_CANCEL_PX }: Props) {
  const { columns, rows, values } = useSheet(doc);
  const gridId = useId().replaceAll(":", "");
  const rowCount = rows.length;
  const colCount = columns.length;
  const bounds = useMemo(() => ({ rows: rowCount, cols: colCount }), [rowCount, colCount]);

  const [frozenRaw, setFrozenRaw] = useState<number>(() => Number(doc.getMap("meta").get("frozen_rows") ?? 0));
  useEffect(() => {
    const meta = doc.getMap("meta");
    const read = () => setFrozenRaw(Number(meta.get("frozen_rows") ?? 0));
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [doc]);
  const frozen = Math.max(0, Math.min(frozenRaw, rowCount));

  const coarse = useCoarsePointer();
  const vv = useVisualViewport();
  /** Grid zoom (pinch on touch). Per person and device, not in the document. */
  const [zoom, setZoom] = useState(() => (typeof window === "undefined" ? 1 : loadZoom()));
  const rowH = Math.round((coarse ? 36 : 28) * zoom);
  const frozenH = frozen * rowH;

  const [selRaw, setSel] = useState<Selection>(() => single({ r: 0, c: 0 }));
  const sel = useMemo(() => clampSelection(selRaw, bounds), [selRaw, bounds]);
  const selRef = useRef(sel);
  selRef.current = sel;

  const [edit, setEdit] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;

  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 800, h: 400 });
  /** Phone-sized: the editor docks above the keyboard instead of sitting in the cell. */
  const compact = coarse && (scroll.w < 600 || vv.height + vv.keyboard < 500);
  const rowHeadW = compact ? 40 : 52;
  /** Variant B: the range "Fill" was chosen for; the fill handle shows only while the selection is still that range. */
  const [fillFor, setFillFor] = useState<Range | null>(null);
  /** Variant B: the range the callout belongs to (shown after a handle drag). */
  const [callout, setCallout] = useState<Range | null>(null);
  const lastHandleRange = useRef<Range | null>(null);
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [fillPreview, setFillPreview] = useState<Range | null>(null);
  const [ants, setAnts] = useState<Range | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "cell" | "row" | "col" } | null>(null);
  const [acIndex, setAcIndex] = useState(0);
  const [acDismissed, setAcDismissed] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ axis: "row" | "col"; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [peers, setPeers] = useState<{ clientId: number; user: User; ranges: Range[]; active: Cell }[]>([]);
  const [announce, setAnnounce] = useState("");

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastPointer = useRef<string>("mouse");
  /** Variant C: set while a hold owns the finger; the touchmove listener then blocks native panning. */
  const holdLock = useRef(false);
  const [armed, setArmed] = useState<{ zone: Hit["zone"]; r: number; c: number } | null>(null);
  const handlesOn = touchVariant === "b" || touchVariant === "c";
  const clipRef = useRef<YcsvClip | null>(null);
  const valuesOnlyNext = useRef(false);
  const caretSync = useRef(false);
  const lastTap = useRef<{ t: number; r: number; c: number } | null>(null);
  /** A double-tap opened the editor: swallow the browser's compat mouse events (they would select a word in it). */
  const suppressCompat = useRef(false);
  /** What the last pointerdown hit. With pointer capture, dblclick targets the scroller. */
  const lastDown = useRef<{ kind: "handle" } | { kind: "resize"; col: number } | null>(null);

  // ---- geometry ---------------------------------------------------------------
  const widths = useMemo(
    () => columns.map((col) => Math.round((liveWidths[col.colId] ?? col.width ?? DEFAULT_W) * zoom)),
    [columns, liveWidths, zoom],
  );
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = 0;
    for (const w of widths) {
      out.push(x);
      x += w;
    }
    out.push(x);
    return out;
  }, [widths]);
  const totalW = lefts[lefts.length - 1] ?? 0;
  const colAt = useCallback(
    (x: number) => {
      if (x < 0) return 0;
      for (let c = 0; c < widths.length; c += 1) if (x < (lefts[c + 1] ?? 0)) return c;
      return Math.max(0, widths.length - 1);
    },
    [lefts, widths],
  );

  /** Row top in viewport coordinates (below the column header). */
  const liveTop = () => scrollerRef.current?.scrollTop ?? scroll.top;
  const liveLeft = () => scrollerRef.current?.scrollLeft ?? scroll.left;
  const rowTopInView = (r: number, top = liveTop()) =>
    r < frozen ? HEADER_H + r * rowH : HEADER_H + frozenH + (r - frozen) * rowH - top;

  const hitTest = useCallback(
    (clientX: number, clientY: number): Hit | null => {
      const el = scrollerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;
      const contentX = vx + el.scrollLeft - rowHeadW;
      const c = colAt(contentX);
      let r: number;
      if (vy < HEADER_H) r = -1;
      else if (vy < HEADER_H + frozenH) r = Math.floor((vy - HEADER_H) / rowH);
      else r = frozen + Math.floor((vy - HEADER_H - frozenH + el.scrollTop) / rowH);
      r = Math.max(-1, Math.min(rowCount - 1, r));
      const inRowHead = vx < rowHeadW;
      const zone = r < 0 && inRowHead ? "corner" : r < 0 ? "colhead" : inRowHead ? "rowhead" : "cell";
      return { zone, r: Math.max(0, r), c, x: contentX, y: vy };
    },
    [colAt, frozen, frozenH, rowCount, rowH, rowHeadW],
  );

  const scrollIntoView = useCallback(
    (cell: Cell) => {
      const el = scrollerRef.current;
      if (!el) return;
      const x = lefts[cell.c] ?? 0;
      const w = widths[cell.c] ?? DEFAULT_W;
      const viewW = el.clientWidth - rowHeadW;
      if (x < el.scrollLeft) el.scrollLeft = x;
      else if (x + w > el.scrollLeft + viewW) el.scrollLeft = x + w - viewW;
      if (cell.r >= frozen) {
        const y = (cell.r - frozen) * rowH;
        const viewH = el.clientHeight - HEADER_H - frozenH;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + rowH > el.scrollTop + viewH) el.scrollTop = y + rowH - viewH;
      }
      // Render the new window in the same pass as the selection, not a frame later on the scroll event.
      readScroll.current();
    },
    [frozen, frozenH, lefts, rowH, widths, rowHeadW],
  );

  /**
   * Scroll position as React state. While nothing is positioned in viewport
   * coordinates (no editor, menu or callout), it moves in steps of half the
   * overscan, so a fling re-renders every few rows instead of every frame.
   * Positions read the live scrollTop/scrollLeft instead (liveTop/liveLeft).
   */
  const exactScroll = useRef(true);
  const scrollStep = useRef({ y: 28, x: 96 });
  const readScroll = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const read = () => {
      const exact = exactScroll.current;
      const { y, x } = scrollStep.current;
      const top = exact ? el.scrollTop : Math.floor(el.scrollTop / y) * y;
      const left = exact ? el.scrollLeft : Math.floor(el.scrollLeft / x) * x;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setScroll((prev) => (prev.top === top && prev.left === left && prev.w === w && prev.h === h ? prev : { top, left, w, h }));
    };
    readScroll.current = read;
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, []);

  // ---- derived ---------------------------------------------------------------
  const colRef = useCallback((c: number) => fileRef(columns[c]?.ref ?? `col${c + 1}`), [columns]);
  const rawAt = useCallback((r: number, c: number) => rows[r]?.cells[columns[c]?.colId ?? ""] ?? "", [rows, columns]);
  const valueAt = useCallback(
    (r: number, c: number) => values.get(`${columns[c]?.ref ?? ""}@${rows[r]?.rowId ?? ""}`),
    [values, rows, columns],
  );
  const isEmpty = useCallback((r: number, c: number) => rawAt(r, c) === "", [rawAt]);
  const defs = useMemo(() => {
    const d = doc.getMap("raw").get("defs");
    return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    // values changes whenever the doc does.
  }, [doc, values]);

  // ---- undo ------------------------------------------------------------------
  const undo = useMemo(() => makeUndoManager(doc), [doc]);
  useEffect(() => {
    const added = (event: { stackItem: { meta: Map<string, unknown> } }) => event.stackItem.meta.set("sel", selRef.current);
    const popped = (event: { stackItem: { meta: Map<string, unknown> } }) => {
      const s = event.stackItem.meta.get("sel") as Selection | undefined;
      if (s) setSel(s);
    };
    undo.on("stack-item-added", added);
    undo.on("stack-item-popped", popped);
    return () => {
      undo.off("stack-item-added", added);
      undo.off("stack-item-popped", popped);
      undo.destroy();
    };
  }, [undo]);

  // ---- awareness (peers) -----------------------------------------------------
  useEffect(() => {
    if (!awareness || !user) return;
    const active = rows[sel.active.r];
    const col = columns[sel.active.c];
    awareness.setLocalStateField("user", user);
    awareness.setLocalStateField("cursor", active && col ? { rowId: active.rowId, colId: col.colId } : null);
    awareness.setLocalStateField(
      "ranges",
      sel.ranges.map((range) => ({
        r1: rows[range.r1]?.rowId,
        r2: rows[range.r2]?.rowId,
        c1: columns[range.c1]?.colId,
        c2: columns[range.c2]?.colId,
      })),
    );
  }, [awareness, user, sel, rows, columns]);
  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const rowIdx = new Map(rows.map((row, i) => [row.rowId, i]));
      const colIdx = new Map(columns.map((col, i) => [col.colId, i]));
      const next: typeof peers = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const s = state as { user?: User; cursor?: { rowId: string; colId: string } | null; ranges?: { r1: string; r2: string; c1: string; c2: string }[] };
        if (!s.user || !s.cursor) return;
        const r = rowIdx.get(s.cursor.rowId);
        const c = colIdx.get(s.cursor.colId);
        if (r === undefined || c === undefined) return;
        const ranges: Range[] = [];
        for (const x of s.ranges ?? []) {
          const a = rowIdx.get(x.r1);
          const b = rowIdx.get(x.r2);
          const ca = colIdx.get(x.c1);
          const cb = colIdx.get(x.c2);
          if (a !== undefined && b !== undefined && ca !== undefined && cb !== undefined) ranges.push(rangeOf({ r: a, c: ca }, { r: b, c: cb }));
        }
        next.push({ clientId, user: s.user, ranges, active: { r, c } });
      });
      setPeers(next);
    };
    awareness.on("change", read);
    read();
    return () => awareness.off("change", read);
  }, [awareness, rows, columns]);

  // ---- focus helpers -----------------------------------------------------------
  const focusGrid = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);
  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2200);
  }, []);

  const select = useCallback(
    (next: Selection, reveal: Cell | null = next.active) => {
      setSel(next);
      if (reveal) scrollIntoView(reveal);
    },
    [scrollIntoView],
  );

  // ---- editing ---------------------------------------------------------------
  const fileFormAt = useCallback((r: number, c: number) => readSnap(doc).toFile(rawAt(r, c)), [doc, rawAt]);

  const startEdit = useCallback(
    (mode: EditState["mode"], initial?: string, source: EditState["source"] = "cell") => {
      const { r, c } = selRef.current.active;
      if (!rows[r] || !columns[c]) return;
      const draft = initial ?? fileFormAt(r, c);
      scrollIntoView({ r, c });
      setEdit({ r, c, mode, draft, caret: draft.length, picked: 0, pickAnchor: null, pickCursor: null, source });
      setAcDismissed(null);
      setAcIndex(0);
      caretSync.current = true;
    },
    [rows, columns, fileFormAt, scrollIntoView],
  );

  const commit = useCallback(
    (moveDir: Dir | null) => {
      const e = editRef.current;
      if (!e) return;
      // Focus moves below; a blur handler must not commit this edit a second time.
      editRef.current = null;
      const snap = readSnap(doc);
      const rowId = snap.rowIds[e.r];
      const colId = snap.colIds[e.c];
      if (rowId && colId) {
        const value = e.draft.startsWith("=") ? snap.toId(e.draft) : e.draft;
        if (value !== snap.raw(e.r, e.c)) writeCells(doc, [{ rowId, colId, value }]);
      }
      setEdit(null);
      setAnts(null);
      if (moveDir) {
        const s = selRef.current;
        select(cycleWithin(s, moveDir, bounds));
      }
      focusGrid();
    },
    [doc, bounds, select, focusGrid],
  );

  const cancel = useCallback(() => {
    setEdit(null);
    focusGrid();
  }, [focusGrid]);

  /** Keep the editor's draft pointing at the same rows when peers insert or delete rows. */
  const idDraft = useRef<string | null>(null);
  useEffect(() => {
    idDraft.current = edit && edit.draft.startsWith("=") ? readSnap(doc).toId(edit.draft) : null;
    // Only the draft text matters here.
  }, [edit?.draft, doc]);
  const rowKey = useMemo(() => rows.map((row) => row.rowId).join(","), [rows]);
  const prevRowKey = useRef(rowKey);
  useEffect(() => {
    if (prevRowKey.current === rowKey) return;
    prevRowKey.current = rowKey;
    const e = editRef.current;
    if (!e || !idDraft.current) return;
    const draft = readSnap(doc).toFile(idDraft.current);
    if (draft !== e.draft) setEdit({ ...e, draft, caret: Math.min(e.caret, draft.length) });
  }, [rowKey, doc]);

  // Put the caret where the model says after programmatic changes.
  useLayoutEffect(() => {
    if (!edit || !caretSync.current) return;
    caretSync.current = false;
    const el = edit.source === "bar" ? barRef.current : inputRef.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(edit.caret, edit.caret);
  }, [edit]);

  const resolver: RefResolver = useCallback(
    (ident: string) => {
      const plain = ident.replaceAll("$", "");
      const unq = plain.startsWith("'") ? plain.replace(/^'((?:[^']|'')*)'?(\d*)$/, (_m, a: string, d: string) => `${a.replaceAll("''", "'")}${d}`) : plain;
      const colIdx = columns.findIndex((col) => col.ref === unq || col.ref === plain);
      if (colIdx >= 0) return { r: editRef.current?.r ?? selRef.current.active.r, c: colIdx };
      const snap = readSnap(doc);
      const id = snap.toId(`=${ident}`);
      const at = id.lastIndexOf("@");
      if (at < 0) return null;
      let col = id.slice(1, at).replace(/^\$/, "");
      if (col.startsWith("'")) col = col.slice(1, -1).replaceAll("''", "'");
      const rowId = id.slice(at + 1).replace(/^\$/, "");
      const r = snap.rowIndex.get(rowId);
      const c = snap.colRefs.indexOf(col);
      return r === undefined || c < 0 ? null : { r, c };
    },
    [columns, doc],
  );

  const segs: Segment[] = useMemo(() => (edit ? segments(edit.draft, resolver) : []), [edit, resolver]);
  const highlights = useMemo(() => refHighlights(segs), [segs]);
  const suggestions = useMemo(() => {
    if (!edit || edit.draft === acDismissed) return null;
    return suggest(edit.draft, edit.caret, columns, defs);
  }, [edit, acDismissed, columns, defs]);
  const sigHelp = useMemo(() => (edit ? signatureAt(edit.draft, edit.caret) : null), [edit]);

  const pick = useCallback((range: Range, cursor: Cell, anchor: Cell | null) => {
    const e = editRef.current;
    if (!e) return;
    const text = refText(range, e.r, colRef);
    const next = insertAt(e.draft, e.caret, e.picked, text);
    caretSync.current = true;
    setEdit({ ...e, draft: next.draft, caret: next.caret, picked: text.length, pickCursor: cursor, pickAnchor: anchor });
  }, [colRef]);

  const acceptSuggestion = useCallback(
    (index: number) => {
      const e = editRef.current;
      const s = suggestions;
      const item = s?.items[index];
      if (!e || !s || !item) return;
      const next = insertAt(e.draft, e.caret, s.token.length, item.insert);
      caretSync.current = true;
      setEdit({ ...e, draft: next.draft, caret: next.caret, picked: 0 });
      setAcIndex(0);
    },
    [suggestions],
  );

  // ---- mutations -------------------------------------------------------------
  const clearRanges = useCallback(
    (ranges: Range[]) => {
      const snap = readSnap(doc);
      const writes: CellWrite[] = [];
      for (const range of ranges) {
        for (let r = range.r1; r <= range.r2; r += 1) {
          for (let c = range.c1; c <= range.c2; c += 1) {
            if (snap.raw(r, c) !== "") writes.push({ rowId: snap.rowIds[r] ?? "", colId: snap.colIds[c] ?? "", value: "" });
          }
        }
      }
      writeCells(doc, writes);
    },
    [doc],
  );

  const applyFill = useCallback(
    (src: Range, target: Range, increment: boolean) => {
      const snap = readSnap(doc);
      const ctx = { colRefs: snap.colRefs, rowIds: snap.rowIds, rowIndex: snap.rowIndex };
      const writes: CellWrite[] = [];
      const put = (r: number, c: number, value: string) => {
        const rowId = snap.rowIds[r];
        const colId = snap.colIds[c];
        if (rowId && colId) writes.push({ rowId, colId, value });
      };
      const n = src.r2 - src.r1 + 1;
      const m = src.c2 - src.c1 + 1;
      if (target.r2 > src.r2 || target.r1 < src.r1) {
        const down = target.r2 > src.r2;
        const k = down ? target.r2 - src.r2 : src.r1 - target.r1;
        const positions = Array.from({ length: k }, (_, i) => (down ? n + i : -1 - i));
        for (let c = src.c1; c <= src.c2; c += 1) {
          const source = Array.from({ length: n }, (_, i) => snap.raw(src.r1 + i, c));
          const out = fillSeries(source, positions, (f, steps) => shiftFormula(f, steps, 0, ctx), { increment });
          out.forEach((v, i) => put(src.r1 + (positions[i] ?? 0), c, v));
        }
      } else if (target.c2 > src.c2 || target.c1 < src.c1) {
        const right = target.c2 > src.c2;
        const k = right ? target.c2 - src.c2 : src.c1 - target.c1;
        const positions = Array.from({ length: k }, (_, i) => (right ? m + i : -1 - i));
        for (let r = src.r1; r <= src.r2; r += 1) {
          const source = Array.from({ length: m }, (_, j) => snap.raw(r, src.c1 + j));
          const out = fillSeries(source, positions, (f, steps) => shiftFormula(f, 0, steps, ctx), { increment });
          out.forEach((v, i) => put(r, src.c1 + (positions[i] ?? 0), v));
        }
      }
      writeCells(doc, writes);
      setSel((s) => ({ ...s, anchor: { r: target.r1, c: target.c1 }, ranges: [target] }));
    },
    [doc],
  );

  /** Double-click on the fill handle: fill down as far as the neighbouring column has data. */
  const fillDownToNeighbour = useCallback(() => {
    const src = lastRange(selRef.current);
    const snap = readSnap(doc);
    const filled = (r: number, c: number) => c >= 0 && c < snap.colIds.length && snap.raw(r, c) !== "";
    const neighbour = filled(src.r2 + 1, src.c1 - 1) ? src.c1 - 1 : filled(src.r2 + 1, src.c2 + 1) ? src.c2 + 1 : -1;
    if (neighbour < 0) return;
    let end = src.r2;
    while (end + 1 < snap.rowIds.length && filled(end + 1, neighbour)) end += 1;
    if (end > src.r2) applyFill(src, { ...src, r2: end }, false);
  }, [doc, applyFill]);

  /** Cmd/Ctrl+D and +R: copy the first row/column of the range into the rest (Excel). */
  const fillCopy = useCallback(
    (axis: "down" | "right") => {
      const range = lastRange(selRef.current);
      const snap = readSnap(doc);
      const ctx = { colRefs: snap.colRefs, rowIds: snap.rowIds, rowIndex: snap.rowIndex };
      const writes: CellWrite[] = [];
      if (axis === "down") {
        const srcRow = range.r1 === range.r2 ? range.r1 - 1 : range.r1;
        if (srcRow < 0) return;
        for (let r = srcRow + 1; r <= range.r2; r += 1)
          for (let c = range.c1; c <= range.c2; c += 1) {
            const v = snap.raw(srcRow, c);
            writes.push({ rowId: snap.rowIds[r] ?? "", colId: snap.colIds[c] ?? "", value: shiftFormula(v, r - srcRow, 0, ctx) });
          }
      } else {
        const srcCol = range.c1 === range.c2 ? range.c1 - 1 : range.c1;
        if (srcCol < 0) return;
        for (let r = range.r1; r <= range.r2; r += 1)
          for (let c = srcCol + 1; c <= range.c2; c += 1) {
            const v = snap.raw(r, srcCol);
            writes.push({ rowId: snap.rowIds[r] ?? "", colId: snap.colIds[c] ?? "", value: shiftFormula(v, 0, c - srcCol, ctx) });
          }
      }
      writeCells(doc, writes);
    },
    [doc],
  );

  // ---- clipboard -------------------------------------------------------------
  const buildClip = useCallback(
    (cut: boolean): { clip: YcsvClip; display: string[][] } | null => {
      const s = selRef.current;
      if (s.ranges.length > 1) {
        flash("Copy works on one range at a time.");
        return null;
      }
      const range = lastRange(s);
      const snap = readSnap(doc);
      const cells: string[][] = [];
      const vals: string[][] = [];
      const display: string[][] = [];
      for (let r = range.r1; r <= range.r2; r += 1) {
        const rc: string[] = [];
        const rv: string[] = [];
        const rd: string[] = [];
        for (let c = range.c1; c <= range.c2; c += 1) {
          rc.push(snap.raw(r, c));
          const v = valueAt(r, c);
          rv.push(valueToString(v));
          const col = columns[c];
          rd.push(v === undefined || !col ? "" : showValue(v, col));
        }
        cells.push(rc);
        vals.push(rv);
        display.push(rd);
      }
      const clip: YcsvClip = {
        v: 1,
        cells,
        values: vals,
        origin: { r: range.r1, c: range.c1 },
        doc: doc.guid,
        wholeRows: isWholeRows(range, bounds),
        wholeCols: isWholeCols(range, bounds),
        cut,
      };
      return { clip, display };
    },
    [doc, valueAt, columns, bounds, flash],
  );

  const onCopyOrCut = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, cut: boolean) => {
      if (editRef.current) return;
      event.preventDefault();
      const built = buildClip(cut);
      if (!built) return;
      event.clipboardData.setData("text/plain", toTsv(built.display));
      event.clipboardData.setData("text/html", toHtml(built.display, built.clip));
      clipRef.current = built.clip;
      setAnts(lastRange(selRef.current));
      setAnnounce(cut ? "Cut" : "Copied");
    },
    [buildClip],
  );

  const doPaste = useCallback(
    (incoming: Incoming | null, valuesOnly: boolean, insert: "rows" | "cols" | null = null) => {
      if (!incoming) return;
      const target = lastRange(selRef.current);
      const commaDecimal = (columns[target.c1]?.locale ?? navigator.language).startsWith("nl");
      let pasted: Range | null = null;
      doc.transact(() => {
        if (insert) {
          const h = incoming.kind === "ycsv" ? incoming.clip.cells.length : incoming.rows.length;
          const w = incoming.kind === "ycsv" ? (incoming.clip.cells[0]?.length ?? 0) : Math.max(...incoming.rows.map((r) => r.length));
          if (insert === "rows") insertRows(doc, target.r1, h);
          else insertColumns(doc, target.c1, w);
        }
        let snap = readSnap(doc);
        const ctx = {
          colRefs: snap.colRefs,
          rowIds: snap.rowIds,
          rowIndex: snap.rowIndex,
          docId: doc.guid,
          toId: snap.toId,
          refAt: (r: number, c: number, absRow: boolean, absCol: boolean) => {
            const ref = snap.colRefs[c];
            const rowId = snap.rowIds[r];
            if (!ref || !rowId) return null;
            return `${absCol ? "$" : ""}${fileRef(ref)}@${absRow ? "$" : ""}${rowId}`;
          },
        };
        const effectiveTarget = insert === "rows" || insert === "cols" ? { ...target, r2: target.r1, c2: target.c1 } : target;
        const plan = planPaste(incoming, effectiveTarget, ctx, { valuesOnly, commaDecimal });
        if (!plan) return;
        const h = plan.block.length;
        const w = plan.block[0]?.length ?? 0;
        // Grow the sheet when the block runs past the edge.
        const needRows = plan.at.r + h - snap.rowIds.length;
        const needCols = plan.at.c + w - snap.colIds.length;
        if (needRows > 0) insertRows(doc, snap.rowIds.length, needRows);
        if (needCols > 0) insertColumns(doc, snap.colIds.length, needCols);
        if (needRows > 0 || needCols > 0) snap = readSnap(doc);
        const writes: CellWrite[] = [];
        const dest = { r1: plan.at.r, c1: plan.at.c, r2: plan.at.r + h - 1, c2: plan.at.c + w - 1 };
        if (plan.clearSource) {
          const src = plan.clearSource;
          for (let r = src.r1; r <= src.r2; r += 1)
            for (let c = src.c1; c <= src.c2; c += 1)
              if (!inRange(dest, r, c)) writes.push({ rowId: snap.rowIds[r] ?? "", colId: snap.colIds[c] ?? "", value: "" });
        }
        plan.block.forEach((row, i) =>
          row.forEach((value, j) => writes.push({ rowId: snap.rowIds[plan.at.r + i] ?? "", colId: snap.colIds[plan.at.c + j] ?? "", value })),
        );
        writeCells(doc, writes);
        pasted = dest;
      }, LOCAL);
      if (pasted) {
        const p = pasted as Range;
        setSel({ active: { r: p.r1, c: p.c1 }, anchor: { r: p.r1, c: p.c1 }, ranges: [p] });
        if (clipRef.current?.cut) {
          clipRef.current = null;
          setAnts(null);
        }
        setAnnounce("Pasted");
      }
    },
    [doc, columns],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      if (editRef.current) return;
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");
      doPaste(readIncoming(html, text), valuesOnlyNext.current);
      valuesOnlyNext.current = false;
    },
    [doPaste],
  );

  /** Menu paste: the async Clipboard API (asks permission; Firefox/Safari show their own Paste button). */
  const pasteFromMenu = useCallback(
    async (valuesOnly: boolean, insert: "rows" | "cols" | null = null) => {
      try {
        let html = "";
        let text = "";
        if (navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
            if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
          }
        } else text = await navigator.clipboard.readText();
        doPaste(readIncoming(html, text), valuesOnly, insert);
      } catch {
        // No system clipboard access (no permission, or Safari's Paste callout was
        // dismissed). A copy made in this sheet can still be pasted from memory.
        const clip = clipRef.current;
        if (clip) doPaste({ kind: "ycsv", clip, grid: clip.values }, valuesOnly, insert);
        else flash(coarse ? "Paste is blocked. Allow clipboard access and try again." : `Use ${MOD}V to paste. This browser blocks paste from the menu.`);
      }
      focusGrid();
    },
    [doPaste, flash, focusGrid, coarse],
  );

  const copyFromMenu = useCallback(
    async (cut: boolean) => {
      const built = buildClip(cut);
      if (!built) return;
      clipRef.current = built.clip;
      setAnts(lastRange(selRef.current));
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([toTsv(built.display)], { type: "text/plain" }),
            "text/html": new Blob([toHtml(built.display, built.clip)], { type: "text/html" }),
          }),
        ]);
        setAnnounce(cut ? "Cut" : "Copied");
      } catch {
        // The copy still works inside this sheet (clipRef); only other apps miss it.
        flash(coarse ? "Copied in this sheet only. The browser blocked the system clipboard." : `Use ${MOD}C to copy. This browser blocks copy from the menu.`);
      }
      focusGrid();
    },
    [buildClip, flash, focusGrid, coarse],
  );

  // ---- row / column ops ------------------------------------------------------
  const autoFit = useCallback(
    (cs: number[]) => {
      doc.transact(() => {
        for (const c of cs) {
          const col = columns[c];
          if (!col) continue;
          let w = textWidth(col.name ?? col.ref, "500 13px system-ui") + textWidth(col.name && col.name !== col.ref ? col.ref : "", "11px system-ui") + 32;
          for (let r = 0; r < rows.length; r += 1) {
            const v = valueAt(r, c);
            if (v === undefined || v === "") continue;
            w = Math.max(w, textWidth(showValue(v, col)) + 18);
          }
          setColumnWidth(doc, col.colId, Math.max(48, Math.min(600, Math.ceil(w))));
        }
      }, LOCAL);
    },
    [doc, columns, rows, valueAt],
  );

  const insertRowsAt = (at: number, count: number) => {
    insertRows(doc, at, count);
    select(selectRows(at, at + count - 1, { rows: rowCount + count, cols: colCount }), null);
  };
  const insertColsAt = (at: number, count: number) => {
    insertColumns(doc, at, count);
    select(selectCols(at, at + count - 1, { rows: rowCount, cols: colCount + count }), null);
  };
  const deleteSelectedRows = () => {
    const idx = new Set<number>();
    for (const range of selRef.current.ranges) for (let r = range.r1; r <= range.r2; r += 1) idx.add(r);
    deleteRows(doc, [...idx]);
    setSel(single({ r: Math.min(...idx), c: selRef.current.active.c }));
  };
  const deleteSelectedCols = () => {
    const idx = new Set<number>();
    for (const range of selRef.current.ranges) for (let c = range.c1; c <= range.c2; c += 1) idx.add(c);
    deleteColumns(doc, [...idx]);
    setSel(single({ r: selRef.current.active.r, c: Math.min(...idx) }));
  };

  /** Touch has no header drag (a finger on a header pans), so moving is a menu step. */
  const moveSelected = (axis: "row" | "col", delta: -1 | 1) => {
    const range = lastRange(selRef.current);
    const from = axis === "row" ? range.r1 : range.c1;
    const count = axis === "row" ? range.r2 - range.r1 + 1 : range.c2 - range.c1 + 1;
    const to = delta < 0 ? from - 1 : from + count + 1;
    const start = delta < 0 ? from - 1 : from + 1;
    if (axis === "row") {
      moveRows(doc, from, count, to);
      select(selectRows(start, start + count - 1, bounds, 0), { r: start, c: 0 });
    } else {
      moveColumns(doc, from, count, to);
      select(selectCols(start, start + count - 1, bounds, 0), { r: 0, c: start });
    }
  };

  // ---- menu ------------------------------------------------------------------
  const openMenuAt = (x: number, y: number, kind: "cell" | "row" | "col") =>
    // Under a finger, open below the contact point so the lifting finger does not land on an item.
    setMenu({ x, y: lastPointer.current === "touch" ? y + 28 : y, kind });

  const menuItems = (kind: "cell" | "row" | "col"): MenuItem[] => {
    const range = lastRange(sel);
    const rowsN = range.r2 - range.r1 + 1;
    const colsN = range.c2 - range.c1 + 1;
    const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
    const clip = clipRef.current;
    const items: MenuItem[] = [
      { id: "cut", label: "Cut", shortcut: `${MOD}X`, onSelect: () => void copyFromMenu(true) },
      { id: "copy", label: "Copy", shortcut: `${MOD}C`, onSelect: () => void copyFromMenu(false) },
      { id: "paste", label: "Paste", shortcut: `${MOD}V`, onSelect: () => void pasteFromMenu(false) },
      { id: "paste-values", label: "Paste values only", shortcut: `${isMac ? "⇧⌘" : "Ctrl+Shift+"}V`, onSelect: () => void pasteFromMenu(true) },
      "sep",
    ];
    if (coarse && kind === "cell") {
      // No ⌘D / ⌘R on a phone keyboard; variant B also has no always-on fill handle.
      if (handlesOn) items.push({ id: "fill-drag", label: "Fill…", onSelect: () => setFillFor(lastRange(selRef.current)) });
      items.push(
        { id: "fill-down", label: "Fill down", disabled: range.r1 === range.r2 && range.r1 === 0, onSelect: () => fillCopy("down") },
        { id: "fill-right", label: "Fill right", disabled: range.c1 === range.c2 && range.c1 === 0, onSelect: () => fillCopy("right") },
        "sep",
      );
    }
    if (coarse && kind === "row") {
      items.push(
        { id: "move-rows-up", label: rowsN === 1 ? "Move row up" : "Move rows up", disabled: range.r1 === 0, onSelect: () => moveSelected("row", -1) },
        { id: "move-rows-down", label: rowsN === 1 ? "Move row down" : "Move rows down", disabled: range.r2 >= rowCount - 1, onSelect: () => moveSelected("row", 1) },
      );
    }
    if (coarse && kind === "col") {
      items.push(
        { id: "move-cols-left", label: colsN === 1 ? "Move column left" : "Move columns left", disabled: range.c1 === 0, onSelect: () => moveSelected("col", -1) },
        { id: "move-cols-right", label: colsN === 1 ? "Move column right" : "Move columns right", disabled: range.c2 >= colCount - 1, onSelect: () => moveSelected("col", 1) },
      );
    }
    if (kind !== "col") {
      items.push(
        { id: "insert-rows-above", label: `Insert ${plural(rowsN, "row", "rows")} above`, onSelect: () => insertRowsAt(range.r1, rowsN) },
        { id: "insert-rows-below", label: `Insert ${plural(rowsN, "row", "rows")} below`, onSelect: () => insertRowsAt(range.r2 + 1, rowsN) },
      );
      if (clip?.wholeRows) items.push({ id: "insert-copied-rows", label: "Insert copied rows above", onSelect: () => void pasteFromMenu(false, "rows") });
      items.push({ id: "delete-rows", label: `Delete ${plural(rowsN, "row", "rows")}`, onSelect: deleteSelectedRows });
    }
    if (kind !== "row") {
      items.push(
        { id: "insert-cols-left", label: `Insert ${plural(colsN, "column", "columns")} left`, onSelect: () => insertColsAt(range.c1, colsN) },
        { id: "insert-cols-right", label: `Insert ${plural(colsN, "column", "columns")} right`, onSelect: () => insertColsAt(range.c2 + 1, colsN) },
      );
      if (clip?.wholeCols) items.push({ id: "insert-copied-cols", label: "Insert copied columns left", onSelect: () => void pasteFromMenu(false, "cols") });
      items.push({ id: "delete-cols", label: `Delete ${plural(colsN, "column", "columns")}`, onSelect: deleteSelectedCols });
    }
    items.push("sep", { id: "clear", label: "Clear contents", shortcut: "Delete", onSelect: () => clearRanges(sel.ranges) });
    if (kind === "col") items.push({ id: "autofit", label: "Fit column width to content", onSelect: () => autoFit(Array.from({ length: colsN }, (_, i) => range.c1 + i)) });
    if (kind !== "col") {
      items.push(
        frozen === range.r2 + 1
          ? { id: "unfreeze", label: "Unfreeze rows", onSelect: () => setFrozenRows(doc, 0) }
          : { id: "freeze", label: `Freeze up to row ${range.r2 + 1}`, onSelect: () => setFrozenRows(doc, range.r2 + 1) },
      );
    }
    return items;
  };

  // ---- keyboard --------------------------------------------------------------
  const pageRows = Math.max(1, Math.floor((scroll.h - HEADER_H - frozenH) / rowH) - 1);

  const navKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const s = selRef.current;
    const mod = modKey(e);
    const arrow: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const dir = arrow[e.key];
    if (dir) {
      e.preventDefault();
      if (e.altKey) return;
      let next: Selection;
      if (mod && e.shiftKey) next = extendToEdge(s, dir, bounds, isEmpty);
      else if (mod) next = single(dataEdge(s.active, dir, bounds, isEmpty));
      else if (e.shiftKey) next = extend(s, dir, bounds);
      else next = move(s, dir, bounds);
      const range = lastRange(next);
      const corner = e.shiftKey ? { r: next.anchor.r === range.r1 ? range.r2 : range.r1, c: next.anchor.c === range.c1 ? range.c2 : range.c1 } : next.active;
      select(next, corner);
      return;
    }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.key === "Tab") {
      e.preventDefault();
      select(cycleWithin(s, e.shiftKey ? "left" : "right", bounds));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) select(cycleWithin(s, "up", bounds));
      else startEdit("edit");
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit("edit");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearRanges(s.ranges);
    } else if (e.key === "Escape") {
      if (ants) {
        e.preventDefault();
        setAnts(null);
        clipRef.current = null;
      }
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const target = mod
        ? e.key === "Home"
          ? { r: 0, c: 0 }
          : { r: rowCount - 1, c: colCount - 1 }
        : { r: s.active.r, c: e.key === "Home" ? 0 : colCount - 1 };
      select(e.shiftKey ? extendTo(s, target) : single(target), target);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const delta = e.key === "PageDown" ? pageRows : -pageRows;
      const target = { r: Math.max(0, Math.min(rowCount - 1, s.active.r + delta)), c: s.active.c };
      select(e.shiftKey ? extendTo(s, target) : single(target), target);
    } else if (mod && k === "a") {
      e.preventDefault();
      select(selectAll(bounds, s.active), null);
    } else if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
    } else if (mod && k === "y" && !isMac) {
      e.preventDefault();
      undo.redo();
    } else if (mod && k === "d") {
      e.preventDefault();
      fillCopy("down");
    } else if (mod && k === "r") {
      e.preventDefault();
      fillCopy("right");
    } else if (e.shiftKey && e.key === " ") {
      e.preventDefault();
      const range = lastRange(s);
      select(selectRows(range.r1, range.r2, bounds, s.active.c), null);
    } else if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      const range = lastRange(s);
      select(selectCols(range.c1, range.c2, bounds, s.active.r), null);
    } else if (mod && e.shiftKey && k === "v") {
      // The paste event that follows carries the data; remember the flavour. Some
      // browsers send no paste event for this chord: then read the clipboard ourselves.
      valuesOnlyNext.current = true;
      window.setTimeout(() => {
        if (!valuesOnlyNext.current) return;
        valuesOnlyNext.current = false;
        void pasteFromMenu(true);
      }, 60);
    } else if (mod && e.altKey && (e.key === "=" || e.code === "Equal")) {
      e.preventDefault();
      const range = lastRange(s);
      if (isWholeCols(range, bounds) && !isWholeRows(range, bounds)) insertColsAt(range.c1, range.c2 - range.c1 + 1);
      else insertRowsAt(range.r1, range.r2 - range.r1 + 1);
    } else if (mod && e.altKey && (e.key === "-" || e.code === "Minus")) {
      e.preventDefault();
      const range = lastRange(s);
      if (isWholeCols(range, bounds) && !isWholeRows(range, bounds)) deleteSelectedCols();
      else deleteSelectedRows();
    } else if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      const rect = scrollerRef.current?.getBoundingClientRect();
      const x = (rect?.left ?? 0) + rowHeadW + (lefts[s.active.c] ?? 0) - liveLeft() + 8;
      const y = (rect?.top ?? 0) + rowTopInView(s.active.r) + rowH;
      const range = lastRange(s);
      openMenuAt(x, y, isWholeRows(range, bounds) ? "row" : isWholeCols(range, bounds) ? "col" : "cell");
    }
  };

  const editKey = (e: KeyboardEvent<HTMLInputElement>, cur: EditState) => {
    const ac = suggestions;
    if (ac && ac.items.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = ac.items.length;
        setAcIndex((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptSuggestion(Math.min(acIndex, ac.items.length - 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAcDismissed(cur.draft);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.altKey) return;
      commit(e.shiftKey ? "up" : "down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "F2") {
      e.preventDefault();
      setEdit({ ...cur, mode: cur.mode === "enter" ? "edit" : "enter" });
      setAnnounce(cur.mode === "enter" ? "Edit mode: arrows move the caret" : "Point mode: arrows pick cells");
    } else if (e.key.startsWith("Arrow")) {
      const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
      const pointing = wantsRef(cur.draft, cur.caret, cur.picked) && (cur.mode === "enter" || cur.picked > 0);
      if (pointing) {
        e.preventDefault();
        const from = cur.pickCursor ?? { r: cur.r, c: cur.c };
        if (e.shiftKey) {
          const anchor = cur.pickAnchor ?? from;
          const to = step(from, dir, bounds);
          pick(rangeOf(anchor, to), to, anchor);
        } else {
          const to = step(from, dir, bounds);
          pick(rangeOf(to, to), to, to);
        }
        return;
      }
      if (cur.mode === "enter") {
        e.preventDefault();
        commit(dir);
      }
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>, source: "cell" | "bar") => {
    if (e.nativeEvent.isComposing) return;
    const cur = editRef.current;
    if (cur) editKey(e, cur);
    else if (source === "cell") navKey(e);
  };

  const onInputChange = (value: string, caret: number, source: "cell" | "bar") => {
    const cur = editRef.current;
    if (!cur) {
      // First keystroke over a cell replaces it (type-to-replace).
      const { r, c } = selRef.current.active;
      if (!rows[r] || !columns[c]) return;
      scrollIntoView({ r, c });
      setEdit({ r, c, mode: "enter", draft: value, caret, picked: 0, pickAnchor: null, pickCursor: null, source });
      setAcDismissed(null);
      setAcIndex(0);
      return;
    }
    setEdit({ ...cur, draft: value, caret, picked: 0, pickAnchor: null, pickCursor: null, source });
    setAcIndex(0);
  };

  // ---- docked editor (phone) --------------------------------------------------
  /** On a phone the formula bar docks above the keyboard while editing. */
  const docked = compact && !!edit && edit.source === "bar";
  const DOCK_ROW = 48;
  const DOCK_KEYS = 48;
  const DOCK_SIG = 26;
  const dockH = docked ? DOCK_ROW + DOCK_KEYS + (sigHelp ? DOCK_SIG : 0) : 0;
  /** Client y of the docked bar's top edge (just above the keyboard). */
  const dockTop = vv.top + vv.height - dockH;

  /** The symbol strip above a phone keyboard: `=`, `(`, `:` … are a layer deep there. */
  const insertSymbol = (text: string) => {
    const cur = editRef.current;
    if (!cur) return;
    const next = insertAt(cur.draft, cur.caret, 0, text);
    caretSync.current = true;
    setEdit({ ...cur, draft: next.draft, caret: next.caret, picked: 0, pickAnchor: null, pickCursor: null });
  };

  // ---- pointer ---------------------------------------------------------------
  /** Last pointer position of a drag; the edge loop re-applies it after each scroll step. */
  const dragPos = useRef<{ x: number; y: number; alt: boolean } | null>(null);
  const edgeFrame = useRef(0);
  const edgeTick = useRef<() => void>(() => {});

  /** Client-space position of a range handle's knob (the corner it sits on). */
  const knobPos = (range: Range, end: boolean, axis: "cell" | "row" | "col") => {
    const rect = scrollerRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const x = axis === "row" ? left + rowHeadW / 2 : left + rowHeadW + (lefts[end ? range.c2 + 1 : range.c1] ?? 0) - liveLeft();
    const y = axis === "col" ? top + HEADER_H / 2 : top + (end ? rowTopInView(range.r2) + rowH : rowTopInView(range.r1));
    return { x, y };
  };

  /** Apply a drag at a client position. Called from pointer moves and from the edge auto-scroll loop. */
  const moveDrag = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d || d.kind === "touch" || d.kind === "resize") return;
    if (d.kind === "handle") {
      // The corner goes to the cell the knob is over (not the finger, which sits beside it).
      const nudge = d.end ? -2 : 2;
      const hit = hitTest(clientX - d.dx + nudge, clientY - d.dy + nudge);
      if (!hit) return;
      const s = selRef.current;
      const range: Range =
        d.axis === "row"
          ? { r1: Math.min(d.fixed.r, hit.r), r2: Math.max(d.fixed.r, hit.r), c1: 0, c2: colCount - 1 }
          : d.axis === "col"
            ? { r1: 0, r2: rowCount - 1, c1: Math.min(d.fixed.c, hit.c), c2: Math.max(d.fixed.c, hit.c) }
            : rangeOf(d.fixed, { r: hit.r, c: hit.c });
      const cur = lastRange(s);
      if (s.ranges.length === 1 && cur.r1 === range.r1 && cur.r2 === range.r2 && cur.c1 === range.c1 && cur.c2 === range.c2) return;
      const active = inRange(range, s.active.r, s.active.c) ? s.active : d.fixed;
      lastHandleRange.current = range;
      setSel({ active, anchor: d.fixed, ranges: [range] });
      return;
    }
    const hit = hitTest(clientX, clientY);
    if (!hit) return;
    const cell = { r: hit.r, c: hit.c };
    if (d.kind === "select") {
      const s = selRef.current;
      const range = lastRange(s);
      const corner = { r: s.anchor.r === range.r1 ? range.r2 : range.r1, c: s.anchor.c === range.c1 ? range.c2 : range.c1 };
      if (corner.r !== cell.r || corner.c !== cell.c) setSel(extendTo(s, cell));
    } else if (d.kind === "pick") {
      pick(rangeOf(d.start, cell), cell, d.start);
    } else if (d.kind === "headers") {
      const s = selRef.current;
      const idx = d.axis === "col" ? hit.c : hit.r;
      const next = d.axis === "col" ? selectCols(d.anchor, idx, bounds, s.active.r) : selectRows(d.anchor, idx, bounds, s.active.c);
      setSel(d.add ? { ...next, active: s.active, ranges: [...s.ranges.slice(0, -1), ...next.ranges] } : { ...next, active: s.active });
    } else if (d.kind === "fill") {
      const R = d.range;
      const dv = cell.r > R.r2 ? cell.r - R.r2 : cell.r < R.r1 ? R.r1 - cell.r : 0;
      const dh = cell.c > R.c2 ? cell.c - R.c2 : cell.c < R.c1 ? R.c1 - cell.c : 0;
      if (dv === 0 && dh === 0) setFillPreview(null);
      else if (dv >= dh) setFillPreview({ ...R, r1: Math.min(R.r1, cell.r), r2: Math.max(R.r2, cell.r) });
      else setFillPreview({ ...R, c1: Math.min(R.c1, cell.c), c2: Math.max(R.c2, cell.c) });
    } else if (d.kind === "move") {
      if (d.axis === "col") {
        const x = hit.x;
        const c = colAt(x);
        const mid = (lefts[c] ?? 0) + (widths[c] ?? 0) / 2;
        setDrop({ axis: "col", index: x < mid ? c : c + 1 });
      } else {
        const rel = hit.y - HEADER_H;
        const r = hit.r;
        const top = rowTopInView(r) - HEADER_H;
        setDrop({ axis: "row", index: rel < top + rowH / 2 ? r : r + 1 });
      }
    }
  };
  const moveDragRef = useRef(moveDrag);
  moveDragRef.current = moveDrag;

  /**
   * Edge auto-scroll that keeps going while the pointer is still (a finger
   * resting at the bottom edge must keep extending the fill or the range).
   * The bottom edge is the top of the keyboard / docked editor when they cover the grid.
   */
  edgeTick.current = () => {
    edgeFrame.current = 0;
    const d = drag.current;
    const p = dragPos.current;
    const el = scrollerRef.current;
    if (!d || !p || !el || d.kind === "touch" || d.kind === "resize") return;
    if (d.kind === "move" && !d.moved) return;
    const rect = el.getBoundingClientRect();
    const band = lastPointer.current === "touch" ? 40 : 24;
    const bottom = Math.min(rect.top + el.clientHeight, vv.top + vv.height - dockH);
    const lockY = (d.kind === "headers" && d.axis === "col") || (d.kind === "handle" && d.axis === "col") || (d.kind === "move" && d.axis === "col");
    const lockX = (d.kind === "headers" && d.axis === "row") || (d.kind === "handle" && d.axis === "row") || (d.kind === "move" && d.axis === "row");
    const dy = lockY ? 0 : edgeSpeed(p.y, rect.top + HEADER_H + frozenH, bottom, band);
    const dx = lockX ? 0 : edgeSpeed(p.x, rect.left + rowHeadW, rect.left + el.clientWidth, band);
    if (!dx && !dy) return;
    const before = el.scrollTop + el.scrollLeft * 1e7;
    if (dy) el.scrollTop += dy;
    if (dx) el.scrollLeft += dx;
    if (el.scrollTop + el.scrollLeft * 1e7 !== before) moveDragRef.current(p.x, p.y);
    edgeFrame.current = requestAnimationFrame(() => edgeTick.current());
  };
  const kickEdgeLoop = () => {
    if (!edgeFrame.current) edgeFrame.current = requestAnimationFrame(() => edgeTick.current());
  };
  useEffect(() => () => cancelAnimationFrame(edgeFrame.current), []);

  /** Variant C: the hold is over (lifted, cancelled, pinched or turned into a menu). */
  const endHold = () => {
    holdLock.current = false;
    setArmed(null);
  };
  const endHoldRef = useRef(endHold);
  endHoldRef.current = endHold;

  /**
   * Variant C: an armed hold moved. Turn it into the drag the press point asks for:
   * a cell extends a range from that cell, a header moves its row or column (the
   * selected block when it is inside one), a column header edge resizes.
   */
  const startHoldDrag = (d: Extract<Drag, { kind: "touch" }>, clientX: number, clientY: number) => {
    window.clearTimeout(d.timer);
    setArmed(null);
    if (editRef.current) commit(null);
    setCallout(null);
    setFillFor(null);
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    const s = selRef.current;
    const range = lastRange(s);
    if (d.zone === "cell") {
      const next = single(d.cell);
      selRef.current = next;
      setSel(next);
      drag.current = { kind: "select" };
    } else if (d.zone === "colhead" || d.zone === "rowhead") {
      const axis = d.zone === "colhead" ? "col" : "row";
      if (axis === "col") {
        // Within RESIZE_EDGE of a column's right edge (or the previous column's): resize.
        const c = d.cell.c;
        const right = (lefts[c] ?? 0) + (widths[c] ?? 0);
        const left = lefts[c] ?? 0;
        const edgeCol = right - d.x <= RESIZE_EDGE ? c : d.x - left <= RESIZE_EDGE && c > 0 ? c - 1 : -1;
        if (edgeCol >= 0) {
          const cs = isWholeCols(range, bounds) && edgeCol >= range.c1 && edgeCol <= range.c2 ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i) : [edgeCol];
          drag.current = { kind: "resize", col: edgeCol, colIds: cs.map((i) => columns[i]?.colId ?? ""), startX: d.startX, startW: (widths[edgeCol] ?? DEFAULT_W) / zoom };
          const w = Math.round(Math.max(32, (widths[edgeCol] ?? DEFAULT_W) / zoom + (clientX - d.startX) / zoom));
          setLiveWidths(Object.fromEntries(cs.map((i) => [columns[i]?.colId ?? "", w])));
          return;
        }
      }
      const idx = axis === "col" ? d.cell.c : d.cell.r;
      const whole = axis === "col" ? isWholeCols(range, bounds) && !isWholeRows(range, bounds) : isWholeRows(range, bounds) && !isWholeCols(range, bounds);
      const inside = axis === "col" ? idx >= range.c1 && idx <= range.c2 : idx >= range.r1 && idx <= range.r2;
      let from = idx;
      let count = 1;
      if (whole && inside && s.ranges.length === 1) {
        from = axis === "col" ? range.c1 : range.r1;
        count = axis === "col" ? range.c2 - range.c1 + 1 : range.r2 - range.r1 + 1;
      } else {
        const next = axis === "col" ? selectCols(idx, idx, bounds, 0) : selectRows(idx, idx, bounds, 0);
        selRef.current = next;
        setSel(next);
      }
      drag.current = { kind: "move", axis, from, count, startX: d.startX, startY: d.startY, moved: true, hit: idx };
    } else {
      drag.current = null;
      endHold();
      return;
    }
    dragPos.current = { x: clientX, y: clientY, alt: false };
    moveDrag(clientX, clientY);
    kickEdgeLoop();
  };

  /**
   * Start editing from a touch. The focus() must happen synchronously inside the
   * touch handler: iOS only raises the keyboard for a focus made during the gesture.
   */
  const beginTouchEdit = () => {
    if (compact) {
      // Phone: edit in the formula bar, docked above the keyboard. Its onFocus starts the edit.
      barRef.current?.focus({ preventScroll: true });
      return;
    }
    const el = inputRef.current;
    if (el) {
      // The nav input is focused with inputmode=none; re-focus it as a text field.
      el.blur();
      el.inputMode = "text";
      el.focus({ preventScroll: true });
    }
    startEdit("edit");
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    lastPointer.current = e.pointerType;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left > el.clientWidth || e.clientY - rect.top > el.clientHeight) return; // scrollbars
    const target = e.target as HTMLElement;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit || rowCount === 0 || colCount === 0) return;
    if (e.button === 2) return; // contextmenu handles it
    setMenu(null);
    const cur = editRef.current;
    const handleEl = target.closest("[data-handle]") as HTMLElement | null;

    // Touch on a cell or header: a tap selects, a double-tap edits, a long-press
    // opens the menu. Any movement is left to the browser, which pans with momentum.
    if (e.pointerType === "touch" && !handleEl && !target.closest(".sx-fill-handle, .sx-resize")) {
      const prev = drag.current;
      if (prev?.kind === "touch") {
        // A second finger: a pinch, not a tap (and not a hold-drag either).
        window.clearTimeout(prev.timer);
        window.clearTimeout(prev.hold);
        drag.current = null;
        endHold();
        return;
      }
      const zone = hit.zone;
      const hold =
        touchVariant === "c" && zone !== "corner"
          ? window.setTimeout(() => {
              const d = drag.current;
              if (d?.kind !== "touch" || d.moved) return;
              // From here the finger owns the gesture: native panning is blocked
              // (see the touchmove listener) and movement drags instead of scrolls.
              d.armed = true;
              holdLock.current = true;
              try {
                el.setPointerCapture(d.pointerId);
              } catch {
                // Synthetic pointers (tests) have no capturable id.
              }
              setArmed({ zone: d.zone, r: d.cell.r, c: d.cell.c });
            }, holdMs)
          : 0;
      const timer = window.setTimeout(() => {
        const d = drag.current;
        if (d?.kind !== "touch" || d.moved) return;
        drag.current = null;
        endHold();
        if ("vibrate" in navigator) navigator.vibrate?.(15);
        if (editRef.current) commit(null);
        setCallout(null);
        const s = selRef.current;
        const range = lastRange(s);
        if (d.zone === "colhead") {
          if (!(isWholeCols(range, bounds) && d.cell.c >= range.c1 && d.cell.c <= range.c2)) setSel(selectCols(d.cell.c, d.cell.c, bounds));
          openMenuAt(d.startX, d.startY, "col");
        } else if (d.zone === "rowhead") {
          if (!(isWholeRows(range, bounds) && d.cell.r >= range.r1 && d.cell.r <= range.r2)) setSel(selectRows(d.cell.r, d.cell.r, bounds));
          openMenuAt(d.startX, d.startY, "row");
        } else if (d.zone === "cell") {
          if (!isSelected(s, d.cell.r, d.cell.c)) setSel(single(d.cell));
          openMenuAt(d.startX, d.startY, "cell");
        }
      }, MENU_MS);
      drag.current = {
        kind: "touch",
        startX: e.clientX,
        startY: e.clientY,
        cell: { r: hit.r, c: hit.c },
        zone,
        moved: false,
        timer,
        hold,
        armed: false,
        pointerId: e.pointerId,
        x: hit.x,
      };
      return;
    }

    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests) have no capturable id.
    }
    const resizeEl = target.closest(".sx-resize") as HTMLElement | null;
    lastDown.current = target.closest(".sx-fill-handle")
      ? { kind: "handle" }
      : resizeEl
        ? { kind: "resize", col: Number(resizeEl.dataset.col) }
        : null;

    if (handleEl) {
      if (cur) commit(null);
      setCallout(null);
      const axis = (handleEl.dataset.axis ?? "cell") as "cell" | "row" | "col";
      const end = handleEl.dataset.handle === "end";
      const range = lastRange(selRef.current);
      const fixed = end ? { r: range.r1, c: range.c1 } : { r: range.r2, c: range.c2 };
      const knob = knobPos(range, end, axis);
      drag.current = { kind: "handle", axis, end, fixed, dx: e.clientX - knob.x, dy: e.clientY - knob.y };
      lastHandleRange.current = range;
      dragPos.current = { x: e.clientX, y: e.clientY, alt: false };
      return;
    }
    if (resizeEl) {
      const c = Number(resizeEl.dataset.col);
      const range = lastRange(selRef.current);
      const cs = isWholeCols(range, bounds) && c >= range.c1 && c <= range.c2 ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i) : [c];
      drag.current = { kind: "resize", col: c, colIds: cs.map((i) => columns[i]?.colId ?? ""), startX: e.clientX, startW: (widths[c] ?? DEFAULT_W) / zoom };
      return;
    }
    if (target.closest(".sx-fill-handle")) {
      if (cur) commit(null);
      setCallout(null);
      drag.current = { kind: "fill", range: lastRange(selRef.current) };
      dragPos.current = { x: e.clientX, y: e.clientY, alt: e.altKey };
      return;
    }

    // Pointing at cells while a formula waits for an operand.
    if (cur && hit.zone === "cell" && wantsRef(cur.draft, cur.caret, cur.picked)) {
      const cell = { r: hit.r, c: hit.c };
      if (e.shiftKey && cur.pickAnchor) pick(rangeOf(cur.pickAnchor, cell), cell, cur.pickAnchor);
      else pick(rangeOf(cell, cell), cell, cell);
      drag.current = { kind: "pick", start: e.shiftKey && cur.pickAnchor ? cur.pickAnchor : cell };
      return;
    }
    if (cur) commit(null);

    const s = selRef.current;
    const mod = modKey(e);
    if (hit.zone === "corner") {
      select(selectAll(bounds, s.active), null);
      focusGrid();
      return;
    }
    if (hit.zone === "colhead" || hit.zone === "rowhead") {
      const axis = hit.zone === "colhead" ? "col" : "row";
      const idx = axis === "col" ? hit.c : hit.r;
      const range = lastRange(s);
      const whole = axis === "col" ? isWholeCols(range, bounds) : isWholeRows(range, bounds);
      const inside = axis === "col" ? idx >= range.c1 && idx <= range.c2 : idx >= range.r1 && idx <= range.r2;
      if (whole && inside && !e.shiftKey && !mod && s.ranges.length === 1) {
        const from = axis === "col" ? range.c1 : range.r1;
        const count = axis === "col" ? range.c2 - range.c1 + 1 : range.r2 - range.r1 + 1;
        drag.current = { kind: "move", axis, from, count, startX: e.clientX, startY: e.clientY, moved: false, hit: idx };
        focusGrid();
        return;
      }
      if (e.shiftKey) {
        const anchor = axis === "col" ? s.anchor.c : s.anchor.r;
        select(axis === "col" ? selectCols(anchor, idx, bounds, s.active.r) : selectRows(anchor, idx, bounds, s.active.c), null);
        drag.current = { kind: "headers", axis, anchor, add: false };
      } else if (mod) {
        const add = axis === "col" ? selectCols(idx, idx, bounds) : selectRows(idx, idx, bounds);
        setSel({ ...add, ranges: [...s.ranges, ...add.ranges] });
        drag.current = { kind: "headers", axis, anchor: idx, add: true };
      } else {
        select(axis === "col" ? selectCols(idx, idx, bounds, 0) : selectRows(idx, idx, bounds, 0), null);
        drag.current = { kind: "headers", axis, anchor: idx, add: false };
      }
      focusGrid();
      return;
    }
    const cell = { r: hit.r, c: hit.c };
    if (e.shiftKey) select(extendTo(s, cell), null);
    else if (mod) select(addRange(s, cell), null);
    else select(single(cell), null);
    drag.current = { kind: "select" };
    focusGrid();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "touch") {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (d.armed) {
        if (dist > HOLD_DRAG_PX) startHoldDrag(d, e.clientX, e.clientY);
        return;
      }
      if (dist > (touchVariant === "c" ? holdSlop : 8)) {
        // Travel before the hold armed: a pan. The browser already owns it.
        d.moved = true;
        window.clearTimeout(d.timer);
        window.clearTimeout(d.hold);
      }
      return;
    }
    if (d.kind === "resize") {
      const w = Math.round(Math.max(32, d.startW + (e.clientX - d.startX) / zoom));
      setLiveWidths(Object.fromEntries(d.colIds.map((id) => [id, w])));
      return;
    }
    if (d.kind === "move" && !d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
    }
    dragPos.current = { x: e.clientX, y: e.clientY, alt: e.altKey };
    moveDrag(e.clientX, e.clientY);
    kickEdgeLoop();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    dragPos.current = null;
    if (!d) return;
    endHold();
    if (d.kind === "touch") {
      window.clearTimeout(d.timer);
      window.clearTimeout(d.hold);
      if (d.moved) return;
      const cur = editRef.current;
      const cell = d.cell;
      if (d.zone === "cell" && cur && wantsRef(cur.draft, cur.caret, cur.picked)) {
        pick(rangeOf(cell, cell), cell, cell);
        return;
      }
      if (cur) commit(null);
      setCallout(null);
      setFillFor(null);
      const s = selRef.current;
      if (d.zone === "corner") {
        select(selectAll(bounds, s.active), null);
        focusGrid();
        return;
      }
      if (d.zone === "colhead" || d.zone === "rowhead") {
        const axis = d.zone === "colhead" ? "col" : "row";
        const idx = axis === "col" ? cell.c : cell.r;
        const range = lastRange(s);
        const whole = axis === "col" ? isWholeCols(range, bounds) && !isWholeRows(range, bounds) : isWholeRows(range, bounds) && !isWholeCols(range, bounds);
        const inside = axis === "col" ? idx >= range.c1 && idx <= range.c2 : idx >= range.r1 && idx <= range.r2;
        // A tap on a selected header opens its actions (Numbers does the same).
        if (whole && inside && s.ranges.length === 1) openMenuAt(e.clientX, e.clientY, axis);
        else select(axis === "col" ? selectCols(idx, idx, bounds, 0) : selectRows(idx, idx, bounds, 0), null);
        focusGrid();
        return;
      }
      const now = performance.now();
      const prev = lastTap.current;
      lastTap.current = { t: now, r: cell.r, c: cell.c };
      setSel(single(cell));
      if (prev && now - prev.t < 350 && prev.r === cell.r && prev.c === cell.c) {
        lastTap.current = null;
        suppressCompat.current = true;
        selRef.current = single(cell);
        beginTouchEdit();
      } else focusGrid();
      return;
    }
    if (d.kind === "handle") {
      // Variant B: offer the common actions right where the finger lifted.
      setCallout(lastHandleRange.current);
      focusGrid();
      return;
    }
    if (d.kind === "select" && e.pointerType === "touch") {
      // Variant C hold-drag ended: the B handles adjust it, the callout acts on it.
      setCallout(lastRange(selRef.current));
      focusGrid();
      return;
    }
    if (d.kind === "resize") {
      const w = Math.round(Math.max(32, d.startW + (e.clientX - d.startX) / zoom));
      doc.transact(() => d.colIds.forEach((id) => setColumnWidth(doc, id, w)), LOCAL);
      setLiveWidths({});
      return;
    }
    if (d.kind === "fill") {
      const preview = fillPreview;
      setFillPreview(null);
      setFillFor(null);
      if (preview) applyFill(d.range, preview, e.altKey);
      focusGrid();
      return;
    }
    if (d.kind === "move") {
      const target = drop;
      setDrop(null);
      if (!d.moved) {
        // A plain click inside the selected headers selects just that one.
        select(d.axis === "col" ? selectCols(d.hit, d.hit, bounds, 0) : selectRows(d.hit, d.hit, bounds, 0), null);
        return;
      }
      if (!target || (target.index >= d.from && target.index <= d.from + d.count)) return;
      const to = target.index;
      const start = to > d.from ? to - d.count : to;
      if (d.axis === "col") {
        moveColumns(doc, d.from, d.count, to);
        setSel(selectCols(start, start + d.count - 1, bounds, 0));
      } else {
        moveRows(doc, d.from, d.count, to);
        setSel(selectRows(start, start + d.count - 1, bounds, 0));
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const down = lastDown.current;
    if (down?.kind === "handle") {
      fillDownToNeighbour();
      return;
    }
    if (down?.kind === "resize") {
      const c = down.col;
      const range = lastRange(selRef.current);
      autoFit(isWholeCols(range, bounds) && c >= range.c1 && c <= range.c2 ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i) : [c]);
      return;
    }
    const hit = hitTest(e.clientX, e.clientY);
    if (hit?.zone === "cell" && !editRef.current) {
      setSel(single({ r: hit.r, c: hit.c }));
      selRef.current = single({ r: hit.r, c: hit.c });
      startEdit("edit");
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Android fires contextmenu on a long-press too; the touch timer already handled it.
    if (lastPointer.current === "touch") return;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit) return;
    if (editRef.current) commit(null);
    const s = selRef.current;
    let kind: "cell" | "row" | "col" = "cell";
    if (hit.zone === "colhead") {
      kind = "col";
      const range = lastRange(s);
      if (!(isWholeCols(range, bounds) && hit.c >= range.c1 && hit.c <= range.c2)) setSel(selectCols(hit.c, hit.c, bounds));
    } else if (hit.zone === "rowhead") {
      kind = "row";
      const range = lastRange(s);
      if (!(isWholeRows(range, bounds) && hit.r >= range.r1 && hit.r <= range.r2)) setSel(selectRows(hit.r, hit.r, bounds));
    } else if (hit.zone === "cell" && !isSelected(s, hit.r, hit.c)) setSel(single({ r: hit.r, c: hit.c }));
    openMenuAt(e.clientX, e.clientY, kind);
  };

  // Keep focus in the grid input when it remounts or selection changes.
  useEffect(() => {
    if (!edit && !menu && document.activeElement === document.body) focusGrid();
  }, [edit, menu, focusGrid]);

  // ---- keyboard: keep the edited cell above it ---------------------------------
  useEffect(() => {
    if (!edit || !coarse) return;
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const visibleTop = Math.max(rect.top + HEADER_H + frozenH, vv.top);
    const visibleBottom = Math.min(rect.top + el.clientHeight, vv.top + vv.height - dockH);
    if (edit.r < frozen) return;
    const cellTop = rect.top + rowTopInView(edit.r, el.scrollTop);
    const cellBottom = cellTop + rowH;
    if (cellBottom > visibleBottom - 8) el.scrollTop += cellBottom - (visibleBottom - 8);
    else if (cellTop < visibleTop) el.scrollTop -= visibleTop - cellTop;
    // Only when the edited cell, the keyboard or the dock changes.
  }, [edit?.r, edit?.c, edit?.source, coarse, vv.top, vv.height, dockH]);

  // ---- pinch: grid zoom, not page zoom -------------------------------------------
  const live = useRef({ zoom, rowH, rowHeadW, frozenH });
  live.current = { zoom, rowH, rowHeadW, frozenH };
  const pinch = useRef<{ d0: number; z0: number; rowH0: number; ax: number; ay: number } | null>(null);
  const zoomAnchor = useRef<{ z0: number; rowH0: number; ax: number; ay: number; cx: number; cy: number } | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = (t: TouchList) => Math.hypot((t[0]?.clientX ?? 0) - (t[1]?.clientX ?? 0), (t[0]?.clientY ?? 0) - (t[1]?.clientY ?? 0));
    const mid = (t: TouchList) => ({ x: ((t[0]?.clientX ?? 0) + (t[1]?.clientX ?? 0)) / 2, y: ((t[0]?.clientY ?? 0) + (t[1]?.clientY ?? 0)) / 2 });
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const d = drag.current;
      if (d?.kind === "touch") {
        window.clearTimeout(d.timer);
        window.clearTimeout(d.hold);
      }
      if (d && d.kind !== "fill" && d.kind !== "handle") drag.current = null;
      endHoldRef.current();
      const m = mid(e.touches);
      const rect = el.getBoundingClientRect();
      const L = live.current;
      pinch.current = {
        d0: Math.max(1, dist(e.touches)),
        z0: L.zoom,
        rowH0: L.rowH,
        ax: el.scrollLeft + m.x - rect.left - L.rowHeadW,
        ay: el.scrollTop + m.y - rect.top - HEADER_H - L.frozenH,
      };
    };
    const move = (e: TouchEvent) => {
      // Variant C: an armed hold or a hold-drag owns the finger; the page must not pan under it.
      if (holdLock.current && e.cancelable) e.preventDefault();
      const p = pinch.current;
      if (!p || e.touches.length !== 2) return;
      e.preventDefault();
      const z = clampZoom((p.z0 * dist(e.touches)) / p.d0);
      const m = mid(e.touches);
      zoomAnchor.current = { z0: p.z0, rowH0: p.rowH0, ax: p.ax, ay: p.ay, cx: m.x, cy: m.y };
      setZoom(z);
    };
    const end = (e: TouchEvent) => {
      if (!pinch.current || e.touches.length >= 2) return;
      pinch.current = null;
      saveZoom(live.current.zoom);
    };
    // Safari's own pinch events: stop the page from zooming while the grid zooms.
    const gesture = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("gesturestart", gesture);
    el.addEventListener("gesturechange", gesture);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("gesturestart", gesture);
      el.removeEventListener("gesturechange", gesture);
    };
  }, []);
  // Keep the content under the pinch centre where it was.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollerRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    const rect = el.getBoundingClientRect();
    el.scrollLeft = (a.ax * zoom) / a.z0 - (a.cx - rect.left - rowHeadW);
    el.scrollTop = (a.ay * rowH) / a.rowH0 - (a.cy - rect.top - HEADER_H - frozenH);
  }, [zoom]);

  // ---- render ----------------------------------------------------------------
  const bodyRows = Math.max(0, rowCount - frozen);
  // While a finger edits, leave room below the last row so it can scroll above the keyboard.
  const kbPad = edit && coarse ? vv.keyboard + dockH : 0;
  const bodyH = bodyRows * rowH + kbPad;
  const viewH = Math.max(0, scroll.h - HEADER_H - frozenH);
  // Fingers fling: render more rows ahead so momentum scrolling does not show blank rows.
  const os = overscan ?? (coarse ? 12 : 4);
  scrollStep.current = { y: Math.max(1, Math.floor(os / 2)) * rowH, x: 96 };
  const first = frozen + Math.max(0, Math.floor(scroll.top / rowH) - os);
  const last = Math.min(rowCount - 1, frozen + Math.ceil((scroll.top + viewH) / rowH) + os);
  const active = sel.active;

  // Variant B range handles (finger only). Whole rows/columns get them on the headers.
  const hRange = lastRange(sel);
  const hWholeRows = isWholeRows(hRange, bounds);
  const hWholeCols = isWholeCols(hRange, bounds);
  const sameRange = (a: Range | null, b: Range) => !!a && a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;
  const fillMode = sameRange(fillFor, hRange) && sel.ranges.length === 1;
  const showCallout = sameRange(callout, hRange) && sel.ranges.length === 1;
  const needExact = !!edit || !!menu || showCallout;
  exactScroll.current = needExact;
  useLayoutEffect(() => {
    if (needExact) readScroll.current();
  }, [needExact]);
  const showHandles = coarse && handlesOn && !edit && !fillMode && sel.ranges.length === 1 && !(hWholeRows && hWholeCols);
  const showFillHandle = !coarse || touchVariant === "a" || fillMode;
  const handle = (end: boolean, axis: "cell" | "row" | "col", style: React.CSSProperties) => (
    <div
      key={`handle-${end ? "end" : "start"}`}
      className={`sx-handle is-${end ? "end" : "start"} is-${axis}`}
      data-handle={end ? "end" : "start"}
      data-axis={axis}
      data-testid={`handle-${end ? "end" : "start"}`}
      aria-hidden="true"
      style={style}
    />
  );

  const selCols = new Set<number>();
  const selRows = new Set<number>();
  const wholeColSet = new Set<number>();
  const wholeRowSet = new Set<number>();
  for (const range of sel.ranges) {
    for (let c = range.c1; c <= range.c2; c += 1) {
      selCols.add(c);
      if (isWholeCols(range, bounds)) wholeColSet.add(c);
    }
    if (range.r2 - range.r1 < 5000)
      for (let r = range.r1; r <= range.r2; r += 1) {
        selRows.add(r);
        if (isWholeRows(range, bounds)) wholeRowSet.add(r);
      }
  }

  const renderRow = (r: number, top: number) => {
    const row = rows[r];
    if (!row) return null;
    // Everything selection-related this row needs, as one string, so memo can skip unchanged rows.
    let cover = "";
    for (const range of sel.ranges) if (r >= range.r1 && r <= range.r2) cover += `${range.c1}-${range.c2},`;
    const headHandle = showHandles && hWholeRows ? (r === hRange.r1 ? 1 : 0) | (r === hRange.r2 ? 2 : 0) : 0;
    return (
      <GridRow
        key={row.rowId}
        row={row}
        r={r}
        top={top}
        rowH={rowH}
        rowHeadW={rowHeadW}
        totalW={totalW}
        columns={columns}
        values={values}
        lefts={lefts}
        widths={widths}
        gridId={gridId}
        cover={cover}
        activeC={r === active.r ? active.c : -1}
        editing={!!edit && r === active.r}
        head={wholeRowSet.has(r) ? "whole" : selRows.has(r) ? "sel" : ""}
        headHandle={headHandle}
      />
    );
  };

  /** Overlay rectangles for rows [r0, r1] of one layer; yOf maps a row to its top in that layer. */
  const overlayFor = (r0: number, r1: number, yOf: (r: number) => number) => {
    const items: ReactNode[] = [];
    if (r1 < r0) return items;
    const box = (range: Range) => {
      const a = Math.max(range.r1, r0);
      const b = Math.min(range.r2, r1);
      if (b < a) return null;
      return {
        left: rowHeadW + (lefts[range.c1] ?? 0),
        top: yOf(a),
        width: (lefts[range.c2 + 1] ?? 0) - (lefts[range.c1] ?? 0),
        height: (b - a + 1) * rowH,
      };
    };
    sel.ranges.forEach((range, i) => {
      const b = box(range);
      if (b && !(range.r1 === range.r2 && range.c1 === range.c2)) items.push(<div key={`r${i}`} className="sx-o sx-o-range" style={b} />);
    });
    highlights.forEach((h, i) => {
      const b = box(h.range);
      if (b) items.push(<div key={`h${i}`} className="sx-o sx-o-ref" data-ref-color={h.color} style={{ ...b, color: REF_COLORS[h.color] }} />);
    });
    peers.forEach((p) => {
      p.ranges.forEach((range, i) => {
        if (range.r1 === range.r2 && range.c1 === range.c2) return;
        const rb = box(range);
        if (rb) items.push(<div key={`p${p.clientId}r${i}`} className="sx-o sx-o-peer-range" style={{ ...rb, color: p.user.color }} />);
      });
      const b = box(rangeOf(p.active, p.active));
      if (b)
        items.push(
          <div key={`p${p.clientId}`} className="sx-o sx-o-peer" style={{ ...b, color: p.user.color }}>
            <span className="sx-o-peer-label" style={{ background: p.user.color }}>
              {p.user.name}
            </span>
          </div>,
        );
    });
    const a = box(rangeOf(active, active));
    if (a) items.push(<div key="active" className="sx-o sx-o-active" data-testid="active-outline" style={a} />);
    if (ants) {
      const b = box(ants);
      if (b) items.push(<div key="ants" className="sx-o sx-o-ants" data-testid="copy-ants" style={b} />);
    }
    if (fillPreview) {
      const b = box(fillPreview);
      if (b) items.push(<div key="fill" className="sx-o sx-o-fill-preview" data-testid="fill-preview" style={b} />);
    }
    const lr = lastRange(sel);
    if (showFillHandle && !edit && sel.ranges.length === 1 && lr.r2 >= r0 && lr.r2 <= r1) {
      const size = coarse ? 14 : 8;
      items.push(
        <div
          key="handle"
          className={`sx-fill-handle${fillMode ? " is-fill-mode" : ""}`}
          data-testid="fill-handle"
          aria-hidden="true"
          style={{ left: rowHeadW + (lefts[lr.c2 + 1] ?? 0) - size / 2 - 1, top: yOf(lr.r2) + rowH - size / 2 - 1 }}
        />,
      );
    }
    if (drop?.axis === "row" && drop.index >= r0 && drop.index <= r1 + 1) {
      const y = drop.index <= r1 ? yOf(drop.index) : yOf(r1) + rowH;
      items.push(<div key="drop" className="sx-o sx-o-drop" data-testid="drop-indicator" style={{ left: 0, top: y - 1, width: totalW + rowHeadW, height: 3 }} />);
    }
    return items;
  };

  /** Variant B handles for a cell range, in their own layer above the sticky row headers. */
  const handlesFor = (r0: number, r1: number, yOf: (r: number) => number) => {
    const items: ReactNode[] = [];
    if (!showHandles || hWholeRows || hWholeCols) return items;
    if (hRange.r1 >= r0 && hRange.r1 <= r1) items.push(handle(false, "cell", { left: rowHeadW + (lefts[hRange.c1] ?? 0), top: yOf(hRange.r1) }));
    if (hRange.r2 >= r0 && hRange.r2 <= r1) items.push(handle(true, "cell", { left: rowHeadW + (lefts[hRange.c2 + 1] ?? 0), top: yOf(hRange.r2) + rowH }));
    return items;
  };

  // Editor geometry, in viewport coordinates.
  const edR = edit ? edit.r : active.r;
  const edC = edit ? edit.c : active.c;
  const cellX = rowHeadW + (lefts[edC] ?? 0) - liveLeft();
  const cellY = rowTopInView(edR);
  const cellW = widths[edC] ?? DEFAULT_W;
  const editorW = edit ? Math.min(Math.max(cellW, textWidth(edit.draft) + 24), Math.max(cellW, scroll.w - cellX - 4)) : cellW;
  const navX = Math.max(rowHeadW, Math.min(cellX, scroll.w - cellW));
  const navY = Math.max(HEADER_H, Math.min(cellY, scroll.h - rowH));
  const inputBox = edit ? { left: cellX, top: cellY, width: editorW, height: rowH } : { left: navX, top: navY, width: cellW, height: rowH };
  const activeRendered = active.r < frozen || (active.r >= first && active.r <= last);
  const isFormula = !!edit && edit.draft.startsWith("=");
  const acId = `${gridId}-ac`;

  const segClass = (seg: Segment) => {
    if (seg.kind === "name") {
      // Still typing this one: not an error yet.
      if (edit && seg.end === edit.caret) return "sx-t-name";
      const known = seg.text.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), defs) !== undefined;
      return known ? "sx-t-name" : "sx-t-name-unknown";
    }
    return `sx-t-${seg.kind}`;
  };

  const status = useMemo(() => {
    let sum = 0;
    let count = 0;
    let nums = 0;
    let seen = 0;
    for (const range of sel.ranges) {
      for (let r = range.r1; r <= range.r2 && seen < 200_000; r += 1)
        for (let c = range.c1; c <= range.c2; c += 1) {
          seen += 1;
          const v = valueAt(r, c);
          if (v === undefined || v === "") continue;
          count += 1;
          if (typeof v === "number") {
            sum += v;
            nums += 1;
          }
        }
    }
    return { sum, count, nums };
  }, [sel, valueAt]);

  // Popover placement. Phone: above the docked editor. Tablet: below the cell, or
  // above it when the keyboard leaves too little room below.
  const vpTop = scrollerRef.current?.getBoundingClientRect().top ?? 0;
  const roomBelow = vv.top + vv.height - vpTop - (inputBox.top + rowH + 4);
  const acPlacement: "dock" | "below" | "above" = docked ? "dock" : coarse && roomBelow < 220 && inputBox.top > roomBelow ? "above" : "below";
  const acStyle: React.CSSProperties =
    acPlacement === "dock"
      ? { position: "fixed", left: vv.left + 8, width: vv.width - 16, top: "auto", bottom: window.innerHeight - dockTop + 4, maxHeight: Math.min(4.5 * 44 + 8, Math.max(132, dockTop - vv.top - 16)) }
      : acPlacement === "above"
        ? { left: inputBox.left, top: "auto", bottom: scroll.h - inputBox.top + 4, maxHeight: Math.max(132, inputBox.top - 8) }
        : { left: inputBox.left, top: inputBox.top + rowH + 4, maxHeight: coarse ? Math.max(132, roomBelow - 8) : undefined };

  // Variant B callout after a handle drag: the iOS-style edit menu, at the selection.
  const calloutW = 300;
  const selTopY = rowTopInView(hRange.r1);
  const calloutTop = selTopY - 52 >= HEADER_H ? selTopY - 52 : Math.min(scroll.h - 52, rowTopInView(hRange.r2) + rowH + 12);
  const calloutLeft = Math.max(4, Math.min(scroll.w - calloutW - 4, rowHeadW + (lefts[hRange.c1] ?? 0) - liveLeft()));

  const lr = lastRange(sel);
  const nameBox = sel.ranges.length > 1 ? `${sel.ranges.length} ranges` : rangeLabel(lr, colRef);
  const barValue = edit ? edit.draft : rowCount && colCount ? fileFormAt(active.r, active.c) : "";

  return (
    <div className="sx-root" data-theme={theme} style={{ height }}>
      {/* The bar keeps its place in the layout; on a phone it docks above the keyboard while editing. */}
      <div className="sx-bar-slot" style={docked ? { height: 41 } : undefined}>
      <div
        className={docked ? "sx-dock" : "sx-bar-host"}
        data-testid="dock"
        data-docked={docked ? "true" : undefined}
        style={docked ? { left: vv.left, width: vv.width, top: dockTop, height: dockH } : undefined}
      >
      {docked && sigHelp ? (
        <div className="sx-dock-sig" role="tooltip" data-testid="signature">
          {sigHelp.sig.name}(
          {sigHelp.sig.params.map((p, i) => (
            <span key={p + i}>
              {i > 0 ? ", " : ""}
              {i === Math.min(sigHelp.arg, sigHelp.sig.params.length - 1) || (p === "…" && sigHelp.arg >= i) ? <b>{p}</b> : p}
            </span>
          ))}
          )
        </div>
      ) : null}
      {docked && suggestions && suggestions.items.length > 0 ? (
        // Phone: suggestions are chips in the dock, so no list covers the cell being edited.
        <div className="sx-dock-keys is-suggestions" role="listbox" aria-orientation="horizontal" id={acId} aria-label="Suggestions" data-testid="autocomplete" data-placement="dock">
          {suggestions.items.map((item, i) => (
            <div
              key={`${item.kind}${item.label}`}
              id={`${acId}-${i}`}
              role="option"
              aria-selected={i === Math.min(acIndex, suggestions.items.length - 1)}
              className="sx-chip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptSuggestion(i)}
            >
              <span className="sx-option-label">{item.label}</span>
            </div>
          ))}
        </div>
      ) : docked ? (
        <div className="sx-dock-keys" role="toolbar" aria-label="Formula symbols">
          {FORMULA_KEYS.map((k) => (
            <button
              type="button"
              tabIndex={-1}
              key={k}
              className="sx-dock-key"
              data-testid={`key-${k}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSymbol(k)}
            >
              {k}
            </button>
          ))}
        </div>
      ) : null}
      <div className="sx-bar">
        <div className="sx-namebox" data-testid="namebox" aria-label="Selection">
          {nameBox}
        </div>
        <span className="sx-fx" aria-hidden="true">
          fx
        </span>
        <input
          ref={barRef}
          className="sx-bar-input"
          data-testid="formula-bar"
          aria-label="Formula bar"
          value={barValue}
          onFocus={() => {
            if (!editRef.current) startEdit("edit", undefined, "bar");
            else setEdit({ ...editRef.current, source: "bar" });
          }}
          onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length, "bar")}
          onSelect={(e) => {
            const cur = editRef.current;
            const caret = (e.target as HTMLInputElement).selectionStart ?? 0;
            if (cur && cur.source === "bar" && cur.caret !== caret) setEdit({ ...cur, caret });
          }}
          onKeyDown={(e) => onInputKeyDown(e, "bar")}
          onBlur={(e) => {
            // iOS "Done", or a tap that moves focus out of the sheet, ends the edit.
            const next = e.relatedTarget as HTMLElement | null;
            if (editRef.current?.source === "bar" && next !== inputRef.current && !next?.closest?.(".sx-root")) commit(null);
          }}
          enterKeyHint={docked ? "enter" : undefined}
        />
        {docked ? (
          <>
            <button type="button" tabIndex={-1} className="sx-dock-btn" aria-label="Cancel edit" data-testid="dock-cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
              ✕
            </button>
            <button type="button" tabIndex={-1} className="sx-dock-btn is-primary" aria-label="Save cell" data-testid="dock-commit" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(null)}>
              ✓
            </button>
          </>
        ) : null}
      </div>
      </div>
      </div>
      <div className="sx-viewport" data-touch-variant={touchVariant} data-coarse={coarse ? "true" : undefined} style={{ ["--sx-row-h" as string]: `${rowH}px`, ["--sx-zoom" as string]: String(zoom) }}>
        <div
          ref={scrollerRef}
          className="sx-scroller"
          role="grid"
          aria-label="Sheet"
          aria-rowcount={rowCount + 1}
          aria-colcount={colCount + 1}
          aria-multiselectable="true"
          data-testid="grid"
          style={{ inset: 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            const d = drag.current;
            if (d?.kind === "touch") {
              window.clearTimeout(d.timer);
              window.clearTimeout(d.hold);
            }
            endHold();
            drag.current = null;
            setFillPreview(null);
            setDrop(null);
          }}
          onMouseDown={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            if (!suppressCompat.current) return;
            suppressCompat.current = false;
            e.preventDefault();
          }}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
        >
          <div role="rowgroup" className="sx-layer" style={{ position: "sticky", top: 0, zIndex: 3, width: totalW + rowHeadW, height: HEADER_H + frozenH }}>
            <div role="row" aria-rowindex={1} className="sx-row" style={{ top: 0, height: HEADER_H, width: totalW + rowHeadW, background: "var(--sx-head-bg)", borderBottom: "1px solid var(--sx-line-strong)", boxSizing: "border-box" }}>
              <div
                className="sx-corner"
                data-testid="corner"
                aria-label="Select all"
                style={{ position: "sticky", left: 0, width: rowHeadW, height: HEADER_H, zIndex: 4 }}
              />
              {columns.map((col, c) => (
                <div
                  key={col.colId}
                  role="columnheader"
                  aria-colindex={c + 2}
                  data-testid={`colhead-${c}`}
                  className={`sx-colhead${wholeColSet.has(c) ? " is-whole" : selCols.has(c) ? " is-sel" : ""}`}
                  style={{ left: rowHeadW + (lefts[c] ?? 0), width: widths[c], height: HEADER_H - 1 }}
                >
                  <span>{col.name ?? col.ref}</span>
                  {col.name && col.name !== col.ref ? <span className="sx-ref">{col.ref}</span> : null}
                </div>
              ))}
              {columns.map((col, c) => (
                <div
                  key={`rs${col.colId}`}
                  className={`sx-resize${coarse && wholeColSet.has(c) && !wholeRowSet.size ? " is-grip" : ""}`}
                  data-col={c}
                  data-testid={`resize-${c}`}
                  style={{ left: rowHeadW + (lefts[c + 1] ?? 0) }}
                />
              ))}
              {showHandles && hWholeCols ? handle(false, "col", { left: rowHeadW + (lefts[hRange.c1] ?? 0), top: HEADER_H / 2 }) : null}
              {showHandles && hWholeCols ? handle(true, "col", { left: rowHeadW + (lefts[hRange.c2 + 1] ?? 0), top: HEADER_H / 2 }) : null}
              {drop?.axis === "col" ? (
                <div className="sx-o sx-o-drop" data-testid="drop-indicator" style={{ left: rowHeadW + (lefts[drop.index] ?? totalW) - 1, top: 0, width: 3, height: HEADER_H }} />
              ) : null}
            </div>
            {Array.from({ length: frozen }, (_, r) => renderRow(r, HEADER_H + r * rowH))}
            {frozen > 0 ? (
              <div className="sx-overlay" style={{ top: HEADER_H, height: frozenH, zIndex: 1 }}>
                {overlayFor(0, frozen - 1, (r) => r * rowH)}
              </div>
            ) : null}
            {frozen > 0 && showHandles ? (
              <div className="sx-overlay" style={{ top: HEADER_H, height: frozenH, zIndex: 2 }}>
                {handlesFor(0, frozen - 1, (r) => r * rowH)}
              </div>
            ) : null}
          </div>
          <div role="rowgroup" className="sx-layer" data-testid="body" data-rows={`${first}-${last}`} data-row-h={rowH} style={{ width: totalW + rowHeadW, height: bodyH }}>
            {Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => renderRow(first + i, (first + i - frozen) * rowH))}
            <div className="sx-overlay" style={{ zIndex: 1 }}>
              {overlayFor(Math.max(frozen, first), last, (r) => (r - frozen) * rowH)}
            </div>
            {showHandles ? (
              <div className="sx-overlay" style={{ zIndex: 2 }}>
                {handlesFor(Math.max(frozen, first), last, (r) => (r - frozen) * rowH)}
              </div>
            ) : null}
          </div>
        </div>

        <div className={`sx-input-wrap ${edit ? "is-editing" : "is-nav"}${docked ? " is-bar-edit" : ""}`} style={inputBox} data-testid="editor-wrap">
          {isFormula && edit?.source === "cell" ? (
            <div className="sx-mirror" aria-hidden="true" data-testid="mirror">
              {segs.map((seg, i) =>
                seg.kind === "ref" ? (
                  <span key={i} className="sx-t-ref" data-ref-color={seg.color} style={{ color: REF_COLORS[seg.color] }}>
                    {seg.text}
                  </span>
                ) : (
                  <span key={i} className={segClass(seg)}>
                    {seg.text}
                  </span>
                ),
              )}
            </div>
          ) : null}
          <input
            ref={inputRef}
            className={`sx-input${isFormula && edit?.source === "cell" ? " is-formula" : ""}`}
            data-testid="cell-input"
            aria-label={edit ? `Edit ${colRef(edit.c)}${edit.r + 1}` : `Sheet, ${colRef(active.c)}${active.r + 1}`}
            aria-activedescendant={
              edit && suggestions ? `${acId}-${Math.min(acIndex, suggestions.items.length - 1)}` : !edit && activeRendered ? `${gridId}-cell-${active.r}-${active.c}` : undefined
            }
            aria-autocomplete={edit ? "list" : undefined}
            aria-controls={edit && suggestions ? acId : undefined}
            aria-expanded={edit ? !!suggestions : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode={edit ? "text" : "none"}
            value={edit && edit.source === "cell" ? edit.draft : edit ? edit.draft : ""}
            onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length, "cell")}
            onSelect={(e) => {
              const cur = editRef.current;
              const caret = (e.target as HTMLInputElement).selectionStart ?? 0;
              if (cur && cur.source === "cell" && cur.caret !== caret) setEdit({ ...cur, caret });
            }}
            onKeyDown={(e) => onInputKeyDown(e, "cell")}
            onCopy={(e) => onCopyOrCut(e, false)}
            onCut={(e) => onCopyOrCut(e, true)}
            onPaste={onPaste}
            onBlur={(e) => {
              // Leaving the sheet commits, like every spreadsheet; moving into the bar does not.
              const next = e.relatedTarget as HTMLElement | null;
              if (editRef.current && next !== barRef.current && !next?.closest?.(".sx-root")) commit(null);
            }}
          />
        </div>

        {edit && suggestions && !docked ? (
          <div
            className="sx-popover"
            role="listbox"
            id={acId}
            aria-label="Suggestions"
            data-testid="autocomplete"
            data-placement={acPlacement}
            style={acStyle}
            onMouseDown={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            if (!suppressCompat.current) return;
            suppressCompat.current = false;
            e.preventDefault();
          }}
          >
            {suggestions.items.map((item, i) => (
              <div
                key={`${item.kind}${item.label}`}
                id={`${acId}-${i}`}
                role="option"
                aria-selected={i === Math.min(acIndex, suggestions.items.length - 1)}
                className="sx-option"
                onClick={() => acceptSuggestion(i)}
              >
                <span className="sx-option-kind">{item.kind === "fn" ? "fx" : item.kind === "col" ? "col" : "def"}</span>
                <span className="sx-option-label">{item.label}</span>
                <span className="sx-option-detail">{item.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
        {edit && sigHelp && !docked ? (
          <div
            className="sx-popover sx-sig"
            role="tooltip"
            data-testid="signature"
            style={acPlacement === "above" ? { left: inputBox.left, top: inputBox.top + rowH + 4 } : { left: inputBox.left, top: Math.max(0, inputBox.top - 58) }}
          >
            <div>
              {sigHelp.sig.name}(
              {sigHelp.sig.params.map((p, i) => (
                <span key={p + i}>
                  {i > 0 ? ", " : ""}
                  {i === Math.min(sigHelp.arg, sigHelp.sig.params.length - 1) || (p === "…" && sigHelp.arg >= i) ? <b>{p}</b> : p}
                </span>
              ))}
              )
            </div>
            <div className="sx-sig-summary">{sigHelp.sig.summary}</div>
          </div>
        ) : null}
        {armed ? (
          // Variant C: the hold armed. Shown only while the finger rests; a drag replaces it.
          <div
            className={`sx-armed is-${armed.zone}`}
            data-testid="armed"
            aria-hidden="true"
            style={
              armed.zone === "colhead"
                ? { left: rowHeadW + (lefts[armed.c] ?? 0) - liveLeft(), top: 0, width: widths[armed.c] ?? DEFAULT_W, height: HEADER_H }
                : armed.zone === "rowhead"
                  ? { left: 0, top: rowTopInView(armed.r), width: rowHeadW, height: rowH }
                  : { left: rowHeadW + (lefts[armed.c] ?? 0) - liveLeft(), top: rowTopInView(armed.r), width: widths[armed.c] ?? DEFAULT_W, height: rowH }
            }
          />
        ) : null}
        {showCallout && coarse && handlesOn && !edit ? (
          <div className="sx-callout" role="toolbar" aria-label="Selection actions" data-testid="callout" style={{ left: calloutLeft, top: calloutTop }} onMouseDown={(e) => e.preventDefault()}>
            {(
              [
                ["cut", "Cut", () => void copyFromMenu(true)],
                ["copy", "Copy", () => void copyFromMenu(false)],
                ["paste", "Paste", () => void pasteFromMenu(false)],
                ["fill", "Fill", () => setFillFor(lastRange(selRef.current))],
              ] as const
            ).map(([id, label, run]) => (
              <button
                key={id}
                type="button"
                tabIndex={-1}
                data-testid={`callout-${id}`}
                onClick={() => {
                  setCallout(null);
                  run();
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              tabIndex={-1}
              aria-label="More actions"
              data-testid="callout-more"
              onClick={(e) => {
                setCallout(null);
                const kind = hWholeRows ? "row" : hWholeCols ? "col" : "cell";
                openMenuAt(e.clientX, e.clientY, kind);
              }}
            >
              ⋯
            </button>
          </div>
        ) : null}
        {toast ? (
          <div className="sx-toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
      <div className="sx-status" data-testid="status">
        {status.count > 1 ? (
          <>
            {status.nums > 0 ? <span>Sum {Number(status.sum.toFixed(10))}</span> : null}
            {status.nums > 0 ? <span>Average {Number((status.sum / status.nums).toFixed(10))}</span> : null}
            <span>Count {status.count}</span>
          </>
        ) : null}
        {edit ? <span data-testid="edit-mode">{edit.mode === "enter" ? "Enter" : "Edit"}</span> : null}
      </div>
      <div className="sx-sr" aria-live="polite">
        {announce}
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.kind === "row" ? "Row actions" : menu.kind === "col" ? "Column actions" : "Cell actions"}
          items={menuItems(menu.kind)}
          onClose={(refocus) => {
            setMenu(null);
            if (refocus) focusGrid();
          }}
        />
      ) : null}
    </div>
  );
}

