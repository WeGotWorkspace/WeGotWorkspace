import {
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
import "./SheetGrid.css";

type User = { id: string; name: string; color: string };
type Props = {
  doc: Y.Doc;
  theme?: "light" | "dark";
  height?: number | string;
  awareness?: Awareness;
  user?: User;
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
  | { kind: "touch"; startX: number; startY: number; cell: Cell; moved: boolean; timer: number };

type Hit = { zone: "cell" | "colhead" | "rowhead" | "corner"; r: number; c: number; x: number; y: number };

const HEADER_H = 30;
const ROWHEAD_W = 52;
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

export function SheetGrid({ doc, theme = "light", height = "100%", awareness, user }: Props) {
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

  const [rowH, setRowH] = useState(28);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const set = () => setRowH(mq.matches ? 36 : 28);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  const frozenH = frozen * rowH;

  const [selRaw, setSel] = useState<Selection>(() => single({ r: 0, c: 0 }));
  const sel = useMemo(() => clampSelection(selRaw, bounds), [selRaw, bounds]);
  const selRef = useRef(sel);
  selRef.current = sel;

  const [edit, setEdit] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;

  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 800, h: 400 });
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
    () => columns.map((col) => liveWidths[col.colId] ?? col.width ?? DEFAULT_W),
    [columns, liveWidths],
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
  const rowTopInView = (r: number, top = scroll.top) =>
    r < frozen ? HEADER_H + r * rowH : HEADER_H + frozenH + (r - frozen) * rowH - top;

  const hitTest = useCallback(
    (clientX: number, clientY: number): Hit | null => {
      const el = scrollerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const vx = clientX - rect.left;
      const vy = clientY - rect.top;
      const contentX = vx + el.scrollLeft - ROWHEAD_W;
      const c = colAt(contentX);
      let r: number;
      if (vy < HEADER_H) r = -1;
      else if (vy < HEADER_H + frozenH) r = Math.floor((vy - HEADER_H) / rowH);
      else r = frozen + Math.floor((vy - HEADER_H - frozenH + el.scrollTop) / rowH);
      r = Math.max(-1, Math.min(rowCount - 1, r));
      const inRowHead = vx < ROWHEAD_W;
      const zone = r < 0 && inRowHead ? "corner" : r < 0 ? "colhead" : inRowHead ? "rowhead" : "cell";
      return { zone, r: Math.max(0, r), c, x: contentX, y: vy };
    },
    [colAt, frozen, frozenH, rowCount, rowH],
  );

  const scrollIntoView = useCallback(
    (cell: Cell) => {
      const el = scrollerRef.current;
      if (!el) return;
      const x = lefts[cell.c] ?? 0;
      const w = widths[cell.c] ?? DEFAULT_W;
      const viewW = el.clientWidth - ROWHEAD_W;
      if (x < el.scrollLeft) el.scrollLeft = x;
      else if (x + w > el.scrollLeft + viewW) el.scrollLeft = x + w - viewW;
      if (cell.r >= frozen) {
        const y = (cell.r - frozen) * rowH;
        const viewH = el.clientHeight - HEADER_H - frozenH;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + rowH > el.scrollTop + viewH) el.scrollTop = y + rowH - viewH;
      }
    },
    [frozen, frozenH, lefts, rowH, widths],
  );

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const read = () => setScroll({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
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
        flash(`Use ${MOD}V to paste. This browser blocks paste from the menu.`);
      }
      focusGrid();
    },
    [doPaste, flash, focusGrid],
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
      } catch {
        flash(`Use ${MOD}C to copy. This browser blocks copy from the menu.`);
      }
      focusGrid();
    },
    [buildClip, flash, focusGrid],
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

  // ---- menu ------------------------------------------------------------------
  const openMenuAt = (x: number, y: number, kind: "cell" | "row" | "col") => setMenu({ x, y, kind });

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
      const x = (rect?.left ?? 0) + ROWHEAD_W + (lefts[s.active.c] ?? 0) - scroll.left + 8;
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

  // ---- pointer ---------------------------------------------------------------
  const autoScroll = (clientX: number, clientY: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 24;
    if (clientY > rect.bottom - edge) el.scrollTop += 20;
    else if (clientY < rect.top + HEADER_H + frozenH + 4 && el.scrollTop > 0) el.scrollTop -= 20;
    if (clientX > rect.right - edge) el.scrollLeft += 20;
    else if (clientX < rect.left + ROWHEAD_W + 4 && el.scrollLeft > 0) el.scrollLeft -= 20;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left > el.clientWidth || e.clientY - rect.top > el.clientHeight) return; // scrollbars
    const target = e.target as HTMLElement;
    const hit = hitTest(e.clientX, e.clientY);
    if (!hit || rowCount === 0 || colCount === 0) return;
    if (e.button === 2) return; // contextmenu handles it
    setMenu(null);
    const cur = editRef.current;

    // Touch: tap selects, double-tap edits, long-press opens the menu. Moving scrolls.
    if (e.pointerType === "touch" && !target.closest(".sx-fill-handle, .sx-resize")) {
      const timer = window.setTimeout(() => {
        const d = drag.current;
        if (d?.kind !== "touch" || d.moved) return;
        drag.current = null;
        if (!isSelected(selRef.current, d.cell.r, d.cell.c)) setSel(single(d.cell));
        openMenuAt(d.startX, d.startY, "cell");
      }, 550);
      drag.current = { kind: "touch", startX: e.clientX, startY: e.clientY, cell: { r: hit.r, c: hit.c }, moved: false, timer };
      return;
    }

    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const resizeEl = target.closest(".sx-resize") as HTMLElement | null;
    lastDown.current = target.closest(".sx-fill-handle")
      ? { kind: "handle" }
      : resizeEl
        ? { kind: "resize", col: Number(resizeEl.dataset.col) }
        : null;

    if (target.closest(".sx-resize")) {
      const c = Number((target.closest(".sx-resize") as HTMLElement).dataset.col);
      const range = lastRange(selRef.current);
      const cs = isWholeCols(range, bounds) && c >= range.c1 && c <= range.c2 ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i) : [c];
      drag.current = { kind: "resize", col: c, colIds: cs.map((i) => columns[i]?.colId ?? ""), startX: e.clientX, startW: widths[c] ?? DEFAULT_W };
      return;
    }
    if (target.closest(".sx-fill-handle")) {
      if (cur) commit(null);
      drag.current = { kind: "fill", range: lastRange(selRef.current) };
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
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
        d.moved = true;
        window.clearTimeout(d.timer);
      }
      return;
    }
    if (d.kind === "resize") {
      const w = Math.max(32, d.startW + e.clientX - d.startX);
      setLiveWidths(Object.fromEntries(d.colIds.map((id) => [id, w])));
      return;
    }
    autoScroll(e.clientX, e.clientY);
    const hit = hitTest(e.clientX, e.clientY);
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
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
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

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "touch") {
      window.clearTimeout(d.timer);
      if (d.moved) return;
      const cur = editRef.current;
      const cell = d.cell;
      if (cur && wantsRef(cur.draft, cur.caret, cur.picked)) {
        pick(rangeOf(cell, cell), cell, cell);
        return;
      }
      if (cur) commit(null);
      const now = performance.now();
      const prev = lastTap.current;
      lastTap.current = { t: now, r: cell.r, c: cell.c };
      setSel(single(cell));
      if (prev && now - prev.t < 350 && prev.r === cell.r && prev.c === cell.c) {
        lastTap.current = null;
        suppressCompat.current = true;
        startEdit("edit");
      } else focusGrid();
      return;
    }
    if (d.kind === "resize") {
      const w = Math.max(32, d.startW + e.clientX - d.startX);
      doc.transact(() => d.colIds.forEach((id) => setColumnWidth(doc, id, w)), LOCAL);
      setLiveWidths({});
      return;
    }
    if (d.kind === "fill") {
      const preview = fillPreview;
      setFillPreview(null);
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

  // ---- render ----------------------------------------------------------------
  const bodyRows = Math.max(0, rowCount - frozen);
  const bodyH = bodyRows * rowH;
  const viewH = Math.max(0, scroll.h - HEADER_H - frozenH);
  const first = frozen + Math.max(0, Math.floor(scroll.top / rowH) - 4);
  const last = Math.min(rowCount - 1, frozen + Math.ceil((scroll.top + viewH) / rowH) + 4);
  const active = sel.active;

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
    return (
      <div key={row.rowId} role="row" aria-rowindex={r + 2} className="sx-row" style={{ top, height: rowH, width: totalW + ROWHEAD_W }}>
        <div
          role="rowheader"
          className={`sx-rowhead${wholeRowSet.has(r) ? " is-whole" : selRows.has(r) ? " is-sel" : ""}`}
          style={{ position: "sticky", left: 0, width: ROWHEAD_W, height: rowH, zIndex: 2, background: "var(--sx-head-bg)", borderRight: "1px solid var(--sx-line-strong)" }}
        >
          {r + 1}
        </div>
        {columns.map((col, c) => {
          const value = values.get(`${col.ref}@${row.rowId}`);
          const err = isCellError(value);
          const selected = isSelected(sel, r, c);
          const isActive = r === active.r && c === active.c;
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
              style={{ left: ROWHEAD_W + (lefts[c] ?? 0), width: widths[c] }}
            >
              {isActive && edit ? "" : text}
            </div>
          );
        })}
      </div>
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
        left: ROWHEAD_W + (lefts[range.c1] ?? 0),
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
    if (!edit && sel.ranges.length === 1 && lr.r2 >= r0 && lr.r2 <= r1) {
      const size = rowH > 30 ? 12 : 8;
      items.push(
        <div
          key="handle"
          className="sx-fill-handle"
          data-testid="fill-handle"
          aria-hidden="true"
          style={{ left: ROWHEAD_W + (lefts[lr.c2 + 1] ?? 0) - size / 2 - 1, top: yOf(lr.r2) + rowH - size / 2 - 1 }}
        />,
      );
    }
    if (drop?.axis === "row" && drop.index >= r0 && drop.index <= r1 + 1) {
      const y = drop.index <= r1 ? yOf(drop.index) : yOf(r1) + rowH;
      items.push(<div key="drop" className="sx-o sx-o-drop" data-testid="drop-indicator" style={{ left: 0, top: y - 1, width: totalW + ROWHEAD_W, height: 3 }} />);
    }
    return items;
  };

  // Editor geometry, in viewport coordinates.
  const edR = edit ? edit.r : active.r;
  const edC = edit ? edit.c : active.c;
  const cellX = ROWHEAD_W + (lefts[edC] ?? 0) - scroll.left;
  const cellY = rowTopInView(edR);
  const cellW = widths[edC] ?? DEFAULT_W;
  const editorW = edit ? Math.min(Math.max(cellW, textWidth(edit.draft) + 24), Math.max(cellW, scroll.w - cellX - 4)) : cellW;
  const navX = Math.max(ROWHEAD_W, Math.min(cellX, scroll.w - cellW));
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

  const lr = lastRange(sel);
  const nameBox = sel.ranges.length > 1 ? `${sel.ranges.length} ranges` : rangeLabel(lr, colRef);
  const barValue = edit ? edit.draft : rowCount && colCount ? fileFormAt(active.r, active.c) : "";

  return (
    <div className="sx-root" data-theme={theme} style={{ height }}>
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
        />
      </div>
      <div className="sx-viewport" style={{ ["--sx-row-h" as string]: `${rowH}px` }}>
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
            if (d?.kind === "touch") window.clearTimeout(d.timer);
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
          <div role="rowgroup" className="sx-layer" style={{ position: "sticky", top: 0, zIndex: 3, width: totalW + ROWHEAD_W, height: HEADER_H + frozenH }}>
            <div role="row" aria-rowindex={1} className="sx-row" style={{ top: 0, height: HEADER_H, width: totalW + ROWHEAD_W, background: "var(--sx-head-bg)", borderBottom: "1px solid var(--sx-line-strong)", boxSizing: "border-box" }}>
              <div
                className="sx-corner"
                data-testid="corner"
                aria-label="Select all"
                style={{ position: "sticky", left: 0, width: ROWHEAD_W, height: HEADER_H, zIndex: 4 }}
              />
              {columns.map((col, c) => (
                <div
                  key={col.colId}
                  role="columnheader"
                  aria-colindex={c + 2}
                  data-testid={`colhead-${c}`}
                  className={`sx-colhead${wholeColSet.has(c) ? " is-whole" : selCols.has(c) ? " is-sel" : ""}`}
                  style={{ left: ROWHEAD_W + (lefts[c] ?? 0), width: widths[c], height: HEADER_H - 1 }}
                >
                  <span>{col.name ?? col.ref}</span>
                  {col.name && col.name !== col.ref ? <span className="sx-ref">{col.ref}</span> : null}
                </div>
              ))}
              {columns.map((col, c) => (
                <div key={`rs${col.colId}`} className="sx-resize" data-col={c} data-testid={`resize-${c}`} style={{ left: ROWHEAD_W + (lefts[c + 1] ?? 0) }} />
              ))}
              {drop?.axis === "col" ? (
                <div className="sx-o sx-o-drop" data-testid="drop-indicator" style={{ left: ROWHEAD_W + (lefts[drop.index] ?? totalW) - 1, top: 0, width: 3, height: HEADER_H }} />
              ) : null}
            </div>
            {Array.from({ length: frozen }, (_, r) => renderRow(r, HEADER_H + r * rowH))}
            {frozen > 0 ? (
              <div className="sx-overlay" style={{ top: HEADER_H, height: frozenH, zIndex: 1 }}>
                {overlayFor(0, frozen - 1, (r) => r * rowH)}
              </div>
            ) : null}
          </div>
          <div role="rowgroup" className="sx-layer" style={{ width: totalW + ROWHEAD_W, height: bodyH }}>
            {Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => renderRow(first + i, (first + i - frozen) * rowH))}
            <div className="sx-overlay" style={{ zIndex: 1 }}>
              {overlayFor(Math.max(frozen, first), last, (r) => (r - frozen) * rowH)}
            </div>
          </div>
        </div>

        <div className={`sx-input-wrap ${edit ? "is-editing" : "is-nav"}`} style={inputBox} data-testid="editor-wrap">
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

        {edit && suggestions ? (
          <div
            className="sx-popover"
            role="listbox"
            id={acId}
            aria-label="Suggestions"
            data-testid="autocomplete"
            style={{ left: inputBox.left, top: inputBox.top + rowH + 4 }}
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
        {edit && sigHelp ? (
          <div className="sx-popover sx-sig" role="tooltip" data-testid="signature" style={{ left: inputBox.left, top: Math.max(0, inputBox.top - 58) }}>
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

