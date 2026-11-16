/**
 * Windowing math for `WorkspaceList` (#1641 step d), generalised from the Contacts
 * list window. Rows stay in normal flow: the list renders runs of rows and puts a
 * spacer of the right size in every gap, so sticky headers, FLIP transforms and the
 * browser's scroll anchoring keep working.
 */

/** At or below this many rows, every row renders (no spacers, no pinning). */
export const WORKSPACE_LIST_WINDOW_AFTER = 80;
/** Rows this far above and below the scrollport stay mounted. */
export const WORKSPACE_LIST_OVERSCAN_PX = 480;
/** Rows to render while the scrollport has no height yet (hidden pane, first paint). */
export const WORKSPACE_LIST_UNSIZED_ROWS = 24;

export type ListWindowRange = { start: number; end: number };

export type ListWindowSegment =
  { kind: "rows"; start: number; end: number } | { kind: "gap"; size: number };

/** Prefix sums: `offsets[i]` is the top of row `i`, `offsets[n]` the full height. */
export function listRowOffsets(sizes: ArrayLike<number>): Float64Array {
  const offsets = new Float64Array(sizes.length + 1);
  for (let index = 0; index < sizes.length; index += 1) {
    offsets[index + 1] = offsets[index]! + sizes[index]!;
  }
  return offsets;
}

/** The first row whose bottom reaches `top` (binary search over `offsets`). */
function firstRowEndingAfter(offsets: Float64Array, top: number): number {
  const count = offsets.length - 1;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1]! > top) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The first row that starts below `bottom`. */
function firstRowStartingAfter(offsets: Float64Array, bottom: number): number {
  const count = offsets.length - 1;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle]! > bottom) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Rows to mount for a scroll position. `scrollTop` is measured from the top of the
 * rows (not the scroller), so content above the list does not shift the window.
 */
export function listWindowRange(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number = WORKSPACE_LIST_OVERSCAN_PX,
): ListWindowRange {
  const count = offsets.length - 1;
  if (count <= WORKSPACE_LIST_WINDOW_AFTER) return { start: 0, end: count };
  if (viewportHeight <= 0) return { start: 0, end: Math.min(count, WORKSPACE_LIST_UNSIZED_ROWS) };
  const start = Math.min(count, firstRowEndingAfter(offsets, Math.max(0, scrollTop - overscanPx)));
  const end = Math.max(
    start,
    firstRowStartingAfter(offsets, scrollTop + viewportHeight + overscanPx),
  );
  return { start, end };
}

/**
 * Runs of rows to render plus the gaps between them. Pinned rows outside the range
 * render at their own offset, each with a gap on either side.
 */
export function listWindowSegments(
  offsets: Float64Array,
  range: ListWindowRange,
  pinned: readonly number[] = [],
): ListWindowSegment[] {
  const count = offsets.length - 1;
  const runs: ListWindowRange[] = [];
  const extra = [...new Set(pinned)]
    .filter((index) => index >= 0 && index < count && (index < range.start || index >= range.end))
    .sort((a, b) => a - b);
  for (const index of extra) {
    if (index < range.start) runs.push({ start: index, end: index + 1 });
  }
  if (range.end > range.start) runs.push(range);
  for (const index of extra) {
    if (index >= range.end) runs.push({ start: index, end: index + 1 });
  }

  const segments: ListWindowSegment[] = [];
  let cursor = 0;
  for (const run of runs) {
    // Neighbouring runs (a pinned row right next to the window) join up.
    const last = segments[segments.length - 1];
    if (run.start === cursor && last?.kind === "rows") {
      last.end = run.end;
      cursor = run.end;
      continue;
    }
    if (run.start > cursor)
      segments.push({ kind: "gap", size: offsets[run.start]! - offsets[cursor]! });
    segments.push({ kind: "rows", start: run.start, end: run.end });
    cursor = run.end;
  }
  if (cursor < count) segments.push({ kind: "gap", size: offsets[count]! - offsets[cursor]! });
  return segments;
}

/** The header row that opens the section holding `index`, if any (Contacts' rule). */
export function sectionHeaderIndex(
  index: number,
  isHeaderAt: ((index: number) => boolean) | undefined,
): number {
  if (!isHeaderAt) return -1;
  for (let candidate = index; candidate >= 0; candidate -= 1) {
    if (isHeaderAt(candidate)) return candidate;
  }
  return -1;
}

/** Number of rows the segments mount. */
export function mountedRowCount(segments: readonly ListWindowSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.kind === "rows") total += segment.end - segment.start;
  }
  return total;
}
