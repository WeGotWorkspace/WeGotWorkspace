/**
 * Spike 8 — screen reader support for the Sheets grid.
 *
 * Pure helpers (no React) so the wording is unit-testable and shared by both focus
 * models. Everything here produces *strings* for one of three channels:
 *
 * 1. the focused gridcell's own name/description (read by the screen reader when focus moves),
 * 2. a polite live region for things focus does not express (range size, edit results),
 * 3. a throttled digest of what collaborators did (never per keystroke, never per caret move).
 */

export type ColumnInfo = { ref: string; name?: string };

/** Header text a screen reader should hear: the display name, plus the formula ref when it differs. */
export function headerLabel(col: ColumnInfo): string {
  const name = col.name ?? col.ref;
  if (name.toLowerCase() === col.ref.toLowerCase()) return name;
  return `${name}, ref ${col.ref}`;
}

export const ERROR_SPEECH: Record<string, string> = {
  "#REF": "reference error",
  "#CYCLE": "circular reference error",
  "#NAME": "name error",
  "#VALUE": "value error",
  "#DIV/0": "division by zero error",
  "#SYNTAX": "syntax error",
};

/**
 * Accessible name of a cell: the displayed value. Errors are spoken as words
 * ("reference error") instead of "number sign R E F exclamation".
 */
export function cellName(display: string, error: string | null): string {
  if (error) return ERROR_SPEECH[error] ?? `${error} error`;
  return display;
}

/**
 * Extra detail for the active cell only (aria-describedby): formula, error help, who else is here.
 * Screen readers read it after the name (NVDA: immediately; VoiceOver: after a pause).
 */
export function cellDetails(opts: { formula?: string | null; errorHelp?: string | null; peers?: string[] }): string {
  const parts: string[] = [];
  if (opts.errorHelp) parts.push(opts.errorHelp.replace(/\.$/, ""));
  if (opts.formula) parts.push(`Formula ${opts.formula}`);
  if (opts.peers?.length) parts.push(`${listNames(opts.peers)} ${opts.peers.length === 1 ? "is" : "are"} also on this cell`);
  return parts.join(". ");
}

export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Prijs row 3" — how a single cell is named in announcements (sheet row numbers, not ARIA indexes). */
export function cellPlace(header: string, r: number): string {
  return `${header} row ${r + 1}`;
}

export type RangeLike = { r1: number; c1: number; r2: number; c2: number };

/**
 * Live-region text for a selection change that focus does not express (Shift+arrows,
 * Shift+Space, ⌘A, header clicks). Single-cell selections return "" because the focused
 * cell already speaks for itself.
 */
export function selectionSpeech(
  ranges: RangeLike[],
  header: (c: number) => string,
  opts: { wholeRows?: boolean; wholeCols?: boolean; all?: boolean; sum?: number | null; count?: number } = {},
): string {
  if (ranges.length === 0) return "";
  if (opts.all) return "Whole sheet selected";
  if (ranges.length > 1) return `${ranges.length} ranges selected`;
  const range = ranges[0]!;
  const rows = range.r2 - range.r1 + 1;
  const cols = range.c2 - range.c1 + 1;
  if (rows === 1 && cols === 1) return "";
  let text: string;
  if (opts.wholeRows) text = rows === 1 ? `Row ${range.r1 + 1} selected` : `Rows ${range.r1 + 1} to ${range.r2 + 1} selected, ${plural(rows, "row")}`;
  else if (opts.wholeCols) text = cols === 1 ? `Column ${header(range.c1)} selected` : `Columns ${header(range.c1)} to ${header(range.c2)} selected, ${plural(cols, "column")}`;
  else
    text = `${cellPlace(header(range.c1), range.r1)} to ${cellPlace(header(range.c2), range.r2)} selected, ${plural(rows, "row")} by ${plural(cols, "column")}`;
  if (opts.sum !== undefined && opts.sum !== null) text += `, sum ${Number(opts.sum.toFixed(10))}`;
  return text;
}

/* ---------------------------------------------------------------------------------------------
 * Remote changes: what collaborators did, as a digest.
 *
 * Policy (decided in spike 8):
 * - A collaborator changing the cell I am on: announce at once ("Anna changed this cell to 4,50").
 * - Rows/columns inserted or deleted by someone else: announce, merged per person, at most once per window.
 * - Edits elsewhere: counted, announced as one line per person at most once per window
 *   ("Anna edited 12 cells"). Off when `cellEdits` is false.
 * - Joins and leaves: announced, merged.
 * - Caret / selection moves of others: never announced. Asked for on demand (presenceSpeech).
 * ------------------------------------------------------------------------------------------- */

export type RemoteEvent =
  | { kind: "here"; who: string; place: string; value: string }
  | { kind: "cells"; who: string; count: number }
  | { kind: "rows"; who: string; inserted: number; deleted: number }
  | { kind: "cols"; who: string; inserted: number; deleted: number }
  | { kind: "join"; who: string }
  | { kind: "leave"; who: string };

export type DigestOptions = { windowMs?: number; cellEdits?: boolean; now?: () => number };

/**
 * Collects remote events and emits at most one announcement per window (default 10 s).
 * "here" events (someone changed the cell under my focus) bypass the window but are
 * themselves limited to one per second.
 */
export class RemoteDigest {
  private pending: RemoteEvent[] = [];
  private lastFlush = -Infinity;
  private lastHere = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly cellEdits: boolean;
  private readonly now: () => number;

  constructor(
    private readonly say: (text: string) => void,
    opts: DigestOptions = {},
  ) {
    this.windowMs = opts.windowMs ?? 10_000;
    this.cellEdits = opts.cellEdits ?? true;
    this.now = opts.now ?? (() => Date.now());
  }

  push(event: RemoteEvent): void {
    const t = this.now();
    if (event.kind === "here") {
      if (t - this.lastHere < 1000) {
        this.pending.push({ kind: "cells", who: event.who, count: 1 });
      } else {
        this.lastHere = t;
        this.say(`${event.who} changed ${event.place} to ${event.value || "blank"}`);
        return;
      }
    } else if (event.kind === "cells" && !this.cellEdits) return;
    else this.pending.push(event);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + this.windowMs - this.now());
    // A short settle delay even when the window is open, so one burst becomes one line.
    this.timer = setTimeout(() => this.flush(), Math.max(wait, 400));
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = summarize(this.pending);
    this.pending = [];
    if (!text) return;
    this.lastFlush = this.now();
    this.say(text);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function summarize(events: RemoteEvent[]): string {
  const per = new Map<string, { cells: number; rowsIn: number; rowsOut: number; colsIn: number; colsOut: number }>();
  const joined: string[] = [];
  const left: string[] = [];
  for (const e of events) {
    if (e.kind === "join") {
      if (!joined.includes(e.who)) joined.push(e.who);
      continue;
    }
    if (e.kind === "leave") {
      if (!left.includes(e.who)) left.push(e.who);
      continue;
    }
    if (e.kind === "here") continue;
    const p = per.get(e.who) ?? { cells: 0, rowsIn: 0, rowsOut: 0, colsIn: 0, colsOut: 0 };
    if (e.kind === "cells") p.cells += e.count;
    else if (e.kind === "rows") {
      p.rowsIn += e.inserted;
      p.rowsOut += e.deleted;
    } else {
      p.colsIn += e.inserted;
      p.colsOut += e.deleted;
    }
    per.set(e.who, p);
  }
  const lines: string[] = [];
  if (joined.length) lines.push(`${listNames(joined)} joined`);
  for (const [who, p] of per) {
    const acts: string[] = [];
    if (p.rowsIn) acts.push(`inserted ${plural(p.rowsIn, "row")}`);
    if (p.rowsOut) acts.push(`deleted ${plural(p.rowsOut, "row")}`);
    if (p.colsIn) acts.push(`inserted ${plural(p.colsIn, "column")}`);
    if (p.colsOut) acts.push(`deleted ${plural(p.colsOut, "column")}`);
    if (p.cells) acts.push(`edited ${plural(p.cells, "cell")}`);
    if (acts.length) lines.push(`${who} ${listNames(acts)}`);
  }
  if (left.length) lines.push(`${listNames(left)} left`);
  return lines.join(". ");
}

/** On-demand answer to "where is everyone?" (⌥⇧P / Alt+Shift+P). */
export function presenceSpeech(peers: { name: string; place: string; editing?: boolean }[]): string {
  if (peers.length === 0) return "Nobody else is in this sheet";
  return peers.map((p) => `${p.name} ${p.editing ? "is editing" : "is on"} ${p.place}`).join(". ");
}

/** Black or white text, whichever reads better on a (peer) colour. Peer colours are not ours to pick. */
export function readableOn(hex: string): "#000" | "#fff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1]!, 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#000" : "#fff";
}
